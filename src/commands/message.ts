import Discord from "discord.js"
// import ytdlDiscord from "ytdl-core-discord"
// import fs from "fs"
// import path from "path"
import ytdlRaw from "ytdl-core"
// import ffmpeg from "fluent-ffmpeg"
// import readline from "readline"
import { getVideoInfo, getVideoUrl } from "../api/youtube"
import logger from "../utils/logger"
import { Server, Song, store } from ".."
import { getSongQueries, searchForTrack } from "../api/spotify"

export async function start(message: Discord.Message, args: string[]) {
  message.channel.startTyping()

  const voiceChannel = message.member?.voice.channel
  if (!voiceChannel) {
    await message.channel.send("Du befindest dich nicht in einem Voice Channel du Mongo")
    message.channel.stopTyping()
    return
  }
  if (!message.guild) {
    await message.channel.send("Gilde nicht definiert")
    message.channel.stopTyping()
    return
  }

  const server = store.get(message.guild.id)

  if (args.length === 0) {
    if (server && server.connection && server.connection.dispatcher) {
      server.connection.dispatcher.resume()
    } else {
      await message.channel.send("Gib 2. Parameter du Mongo")
    }
    message.channel.stopTyping()
    return
  }
  // eslint-disable-next-line no-useless-escape
  const urlRegex = /[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&\/=]*)?/gi

  let songs: Song[] = []

  try {
    if (args[0].match(new RegExp(urlRegex))) {
      // handle link
      if (args[0].includes("spotify")) {
        // handle spotify
        const titles = await getSongQueries(args[0])
        const amount = Number(args[1])
        if (amount && amount > 1) {
          for (let i = 0; i < amount; i++) {
            songs = [...titles.map((t) => ({ title: t }))]
          }
        } else {
          songs = [...titles.map((t) => ({ title: t }))]
        }
      } else if (args[0].includes("youtube")) {
        // play link directly
        const song = await getVideoInfo(args[0])
        const amount = Number(args[1])
        if (amount && amount > 1) {
          for (let i = 0; i < amount; i++) {
            songs.push(song)
          }
        } else {
          songs.push(song)
        }
      } else {
        await message.channel.send("Nur Youtube Links werden unterstützt du Mongo")
        message.channel.stopTyping()
        return
      }
    } else {
      // normal search terms
      const item = await getVideoUrl(args.join(" "))
      const song: Song = {
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      }
      songs.push(song)
    }
  } catch (error) {
    logger.error(error)
    await message.channel.send("Evtl. ist die Youtube API Quota überstiegen")
  }

  if (!server) {
    // new server
    const newServer: Server = {
      id: message.guild.id,
      songs,
      connection: null,
      voiceChannel,
      textChannel: message.channel,
    }
    store.set(message.guild.id, newServer)
    try {
      const connection = await voiceChannel.join()
      connection.voice?.setSelfDeaf(true)
      newServer.connection = connection
      await play(message.guild.id, songs[0])
    } catch (error) {
      logger.error(error)
      store.delete(message.guild.id)
      message.channel.send(error)
    }
  } else {
    // just add song to queue
    server.songs = [...server.songs, ...songs]
    if (songs.length > 1) {
      message.channel.send(`${songs.map((s) => s.title).join(", ")} sind jetzt in der queue`)
    } else {
      message.channel.send(`${songs[0].title} ist jetzt in der queue`)
    }
  }
  message.channel.stopTyping()
}

export async function play(guildId: string, song: Song) {
  const server = store.get(guildId)
  if (!server) {
    return
  }
  if (!song) {
    // queue empty
    server?.voiceChannel?.leave()
    store.delete(guildId)
    return
  }
  if (!server.connection) {
    // not in voice channel
    return
  }
  if (!song.url) {
    const item = await getVideoUrl(song.title)
    song.title = item.snippet.title
    song.url = `https://www.youtube.com/watch?v=${item.id.videoId}`
  }
  // const fileName = path.join(__dirname, `../../data/${song.title}.mp3`)
  // if (!fs.existsSync(fileName)) {
  //   await new Promise((resolve) => {
  //     console.log("starting download", song.url)
  //     const startTime = Date.now()
  //     const stream = ytdlRaw(song.url!, {
  //       filter: "audioonly",
  //       // dlChunkSize: 0,
  //       quality: "highestaudio",
  //     })
  //     ffmpeg(stream)
  //       .audioBitrate(128)
  //       .save(fileName)
  //       .on("progress", (p) => {
  //         readline.cursorTo(process.stdout, 0)
  //         process.stdout.write(`${p.targetSize}kb downloaded`)
  //       })
  //       .on("end", () => {
  //         console.log(`\ndone, thanks - ${(Date.now() - startTime) / 1000}s`)
  //         resolve()
  //       })
  //   })
  // }

  const stream = ytdlRaw(song.url!, {
    filter: "audioonly",
    dlChunkSize: 0,
    quality: "highestaudio",
  })

  server.connection
    .play(stream, {
      // type: "opus",
      // highWaterMark: 50,
    })
    .on("finish", async () => {
      server.songs.shift()
      if (!server.songs[0] && server.connection) {
        console.log("getting recommends because last song")
        try {
          const recommendations = await searchForTrack(song.title)

          if (!recommendations) {
            await server.textChannel.send(`Ich habe leider keine Auto play Vorschläge für ${song.title} gefunden`)
          } else {
            for (let i = 0; i < recommendations.length; i++) {
              const recommendation = recommendations[i]
              server.songs.push({ title: `${recommendation.artists![0].name} - ${recommendation.name}` })
            }
            await server.textChannel.send(`Auto play: ${recommendations.length} neue Lieder sind in der Schlange`)
          }
        } catch (error) {
          logger.error(error)
        }
      }
      play(guildId, server.songs[0])
    })
    .on("error", (error) => logger.error(error))
    .on("close", () => {
      logger.error("connection on close")
    })
    .on("debug", (info) => {
      logger.error("DEBUG", info)
    })
  await server.textChannel.send(`Los geht's mit ${song.title}`)
}

export async function stop(message: Discord.Message) {
  if (!message.member?.voice.channel) {
    await message.channel.send("Du befindest dich nicht in einem Voice Channel du Mongo")
    return
  }
  const server = store.get(message.guild?.id as string) as Server
  server.songs = []
  await server.voiceChannel.leave()
  store.delete(message.guild?.id as string)
  await message.react("🟥")
}

export async function pause(message: Discord.Message) {
  if (!message.member?.voice.channel) {
    await message.channel.send("Du befindest dich nicht in einem Voice Channel du Mongo")
    return
  }
  const server = store.get(message.guild?.id as string) as Server
  server.connection?.dispatcher.pause()
  await message.react("⏸")
}

export async function skip(message: Discord.Message) {
  if (!message.member?.voice.channel) {
    await message.channel.send("You have to be in a voice channel to stop the music!")
    return
  }
  const server = store.get(message.guild?.id as string)
  if (!server) {
    await message.channel.send("There is no song that I could skip!")
    return
  }
  // ending current dispatcher triggers the on end hook which plays the next song
  server.connection?.dispatcher.end()
}

export async function leave(message: Discord.Message) {
  const server = store.get(message.guild?.id as string) as Server
  if (server.voiceChannel) {
    store.delete(message.guild?.id as string)
    await server.voiceChannel.leave()
    await message.react("👋")
  }
}

export async function queueFull(message: Discord.Message) {
  const server = store.get(message.guild?.id as string)
  if (!server) {
    await message.channel.send("Grade läuft doch gar nichts")
  } else if (server.songs.length === 0) {
    await message.channel.send("Nichts in der queue")
  } else {
    const fields: Discord.EmbedFieldData[] = [{ name: "Aktueller Titel", value: `1) ${server.songs[0].title}` }]
    if (server.songs.length > 1) {
      let text = ""
      for (let i = 1; i < server.songs.length; i++) {
        const song = server.songs[i]
        const songTitle = `${i + 1}) ${song.title}`
        text += `${songTitle}\n`
        if (i % 9 === 0) {
          fields.push({ name: `Als nächstes`, value: text })
          text = ""
        } else if (i === server.songs.length - 1) {
          fields.push({ name: `Als nächstes`, value: text })
        }
      }
    }
    const queueMessage = new Discord.MessageEmbed()
      .setColor("#0099ff")
      .setTitle("Ganze Queue")
      .setDescription("Du kannst '_jump X' benutzen um zur Nummer X zu skippen")
      .addFields(...fields)
      .setTimestamp()
      .setFooter("Flötenbot bester Bot")
    await message.channel.send(queueMessage)
  }
}

export async function queue(message: Discord.Message) {
  const server = store.get(message.guild?.id as string)
  if (!server) {
    await message.channel.send("Grade läuft doch gar nichts")
  } else if (server.songs.length === 0) {
    await message.channel.send("Nichts in der queue")
  } else {
    console.log(server.songs)
    const fields: Discord.EmbedFieldData[] = [{ name: "Aktueller Titel", value: `1) ${server.songs[0].title}` }]
    if (server.songs.length > 1) {
      console.log("longer than 1")
      let text = ""
      for (let i = 1; i < Math.min(10, server.songs.length); i++) {
        const song = server.songs[i]
        console.log(song.title)
        const songTitle = `${i + 1}) ${song.title}`
        text += `${songTitle}\n`
      }
      text += `...\nTotal: ${server.songs.length}`
      fields.push({ name: `Als nächstes`, value: text })
    }
    const queueMessage = new Discord.MessageEmbed()
      .setColor("#0099ff")
      .setTitle("Kurze Queue")
      .setDescription("Du kannst '_jump X' benutzen um zur Nummer X zu skippen")
      .addFields(...fields)
      .setTimestamp()
      .setFooter("Flötenbot bester Bot")
    await message.channel.send(queueMessage)
  }
}

export async function jump(message: Discord.Message, args: string[]) {
  const server = store.get(message.guild?.id as string)
  const position = Number(args[0])
  if (!server) {
    await message.channel.send("Grade läuft doch gar nichts")
  } else if (server.songs.length === 0) {
    await message.channel.send("Nichts in der queue")
  } else if (args.length > 1) {
    await message.channel.send("Nur 1 Paramter (jump position) du Mongo")
  } else if (!position || position < 0) {
    await message.channel.send("Du musst auch eine valide Nummer angeben du Mongo")
  } else if (position === 1) {
    await message.channel.send("Das Lied läuft doch schon du Mongo")
  } else if (position > server.songs.length) {
    await message.channel.send("So viele Lieder sind gar nicht in der Queue du Mongo")
  } else {
    // one queue element is removed on dispatcher end
    // so if we only jump one ahead it splices (0, 0) and it is handled like a skip
    server.songs.splice(0, position - 2)
    server.connection?.dispatcher.end()
  }
}
