import Discord from "discord.js"
// import path from "path"

export async function onVoiceStateUpdate(oldState: Discord.VoiceState, newState: Discord.VoiceState) {
  console.log("voice state update")
  if (oldState.member?.user.bot || newState.member?.user?.bot) {
    console.log("bot event, skipping")
  }
  // const channel = newState.channel ?? oldState.channel
  // const connection = await channel?.join()
  // console.log("path", path.join(__dirname, "../../flipflop.mp3"))
  // connection?.play(path.join(__dirname, "../../flipflop.mp3"))
}
