import axios from "axios"
import ytdlDiscord from "discord-ytdl-core"
import { GOOGLE_TOKEN } from "../config"
import { Item, YoutubeSearchResult } from "../types/youtube"
import { Song } from ".."
import logger from "../utils/logger"

export async function getVideoUrl(query: string): Promise<Item> {
  try {
    const { data } = await axios.get<YoutubeSearchResult>(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURI(query)}&key=${GOOGLE_TOKEN}`,
    )
    if (data.items && data.items.length > 0) {
      const item = data.items[0]
      return item
    }
    throw new Error("No items")
  } catch (error) {
    logger.error(error.message)
    throw new Error(error)
  }
}

export async function getHackyVideoId(query: string): Promise<{ id: string; name: string }> {
  try {
    const { data } = await axios.post(
      `https://www.youtube.com/youtubei/v1/search?&key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`,
      {
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20201105.01.01",
          },
        },
        query,
      },
    )
    // beware, its a monster
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]
        ?.itemSectionRenderer?.contents
    const videoRenderer = contents?.find((e: any) => !!e.videoRenderer)?.videoRenderer
    const id = videoRenderer?.videoId
    const name = videoRenderer?.title?.runs?.[0]?.text
    // const id =
    //   data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]
    //     ?.itemSectionRenderer?.contents?.[0]?.videoRenderer?.videoId
    // const name =
    //   data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]
    //     ?.itemSectionRenderer?.contents?.[0]?.videoRenderer?.title?.runs?.[0]?.text
    if (id && name) {
      return { id, name }
    }
    throw new Error("Malformed Response")
  } catch (error) {
    logger.error(error.message)
    logger.error("CHECK HACKY YOUTUBE VIDEO ID GETTING")
    // try fallback
    const item = await getVideoUrl(query)
    return { id: item.id.videoId, name: item.snippet.title }
  }
}

export async function getVideoInfo(url: string): Promise<Song> {
  try {
    const data = await ytdlDiscord.getInfo(url)
    if (!data) {
      throw new Error("No item")
    }
    const song: Song = {
      url: data.videoDetails.video_url,
      title: data.videoDetails.title,
    }
    return song
  } catch (error) {
    logger.error(error)
    throw new Error(error)
  }
}
