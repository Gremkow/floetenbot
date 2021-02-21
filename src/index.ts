import Discord from "discord.js"
import { TOKEN } from "./config"
import { onMessage } from "./handlers/message"
// import { onVoiceStateUpdate } from "./handlers/voiceStateUpdate"
import logger from "./utils/logger"

export interface Server {
  songs: Song[]
  connection: Discord.VoiceConnection | null
  id: string
  voiceChannel: Discord.VoiceChannel
  textChannel: Discord.TextChannel | Discord.DMChannel | Discord.NewsChannel
}

export interface Song {
  url?: string
  title: string
}

export const store = new Map<string, Server>()

const client = new Discord.Client()

client.on("ready", () => {
  logger.log("info", "The bot is online!")
  client.user?.setActivity("_help for help", { type: "WATCHING" })
})
client.on("debug", (m) => logger.log("debug", m))
client.on("warn", (m) => logger.log("warn", m))
client.on("error", (m) => logger.log("error", m))

process.on("uncaughtException", (error) => logger.log("error", error))

client.on("message", onMessage)

client.login(TOKEN)
