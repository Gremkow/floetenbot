import Discord from "discord.js"
import ytdlDiscord from "discord-ytdl-core"
// import fs from "fs"
// import path from "path"
// import ffmpeg from "fluent-ffmpeg"
// import readline from "readline"
import { getHackyVideoId, getVideoInfo } from "../api/youtube"
import logger from "../utils/logger"
import { Server, Song, store } from ".."
import { getSongQueries, searchForTrack } from "../api/spotify"
import { shuffleArray } from "../utils/utils"

export async function shuffle(message: Discord.Message) {
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
  if (server && server.songs && server.songs.length > 1) {
    shuffleArray(server.songs)
  }
  message.channel.stopTyping()
  await message.react("🔀")
}

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
      const item = await getHackyVideoId(args.join(" "))
      const song: Song = {
        title: item.name,
        url: `https://www.youtube.com/watch?v=${item.id}`,
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
    if (server.connection) {
      if (server.connection.dispatcher) {
        console.log("destroying dispatcher")
        server.connection.dispatcher.destroy()
      }
      server.connection.disconnect()
    }
    store.delete(guildId)
    return
  }
  if (!server.connection) {
    // not in voice channel
    return
  }
  if (!song.url) {
    const item = await getHackyVideoId(song.title)
    song.title = item.name
    song.url = `https://www.youtube.com/watch?v=${item.id}`
  }

  const stream = ytdlDiscord(song.url!, {
    filter: "audioonly",
    opusEncoded: true,
    dlChunkSize: 0,
  })
    .on("close", () => {
      console.log("ytdl stream closed")
      stream?.destroy()
    })
    .on("end", () => {
      console.log("yctdl stream ended")
      stream?.destroy()
    })
    .on("error", (err: Error) => {
      console.log("ytdl stream error", err.message)
      stream?.destroy()
    })

  server.connection
    .play(stream, {
      type: "opus",
    })
    .on("finish", async () => {
      stream?.destroy()
      server.connection?.dispatcher?.destroy()
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
    .on("error", (error) => {
      logger.error(error)
      server.connection?.dispatcher?.destroy()
      stream?.destroy()
    })
    .on("close", () => {
      console.log("destroying stream")
      logger.error("connection on close")
      stream?.destroy()
      server.connection?.dispatcher?.destroy()
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
  if (server.connection) {
    if (server.connection.dispatcher) {
      console.log("destroying dispatcher")
      server.connection.dispatcher.destroy()
    }
    server.connection.disconnect()
  }
  store.delete(message.guild?.id as string)
  await message.react("🟥")
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

export async function help(message: Discord.Message) {
  const fields = [
    {
      name: "_play query|youtube|spotify",
      value:
        "Spielt den Youtube/Spotify Link ab oder sucht auf Youtube nach dem Begriff. Wenn schon etwas läuft kommt das in die Queue.",
    },
    {
      name: "_stop",
      value: "Stoppt die Wiedergabe und der Bot verlässt den Channel.",
    },
    {
      name: "_skip",
      value: "Skippt zum nächsten Lied. Wenn nichts in der Queue ist verlässt der Bot den Channel.",
    },
    {
      name: "_queue",
      value: "Zeigt die nächsten Lieder in der Queue an.",
    },
    {
      name: "_jump X",
      value: "Springt zur Position X in der Queue.",
    },
  ]
  const helpMessage = new Discord.MessageEmbed()
    .setColor("#0099ff")
    .setTitle("Tipps")
    .setDescription("Diese Commands kannst du benutzen:")
    .addFields(...fields)
    .setTimestamp()
    .setFooter("Flötenbot bester Bot")
  await message.channel.send(helpMessage)
}
