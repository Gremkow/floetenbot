import axios from "axios"
import qs from "querystring"
import { SPOTIFY_ENCODED_AUTH } from "../config"
import { Album, ArtistsEntity, Playlist, TopTracks, Track } from "../types/spotify"
import logger from "../utils/logger"

export async function getToken(): Promise<string | null> {
  try {
    const body = { grant_type: "client_credentials" }
    const { data } = await axios.post("https://accounts.spotify.com/api/token", qs.stringify(body), {
      headers: { Authorization: `Basic ${SPOTIFY_ENCODED_AUTH}`, "Content-Type": "application/x-www-form-urlencoded" },
    })
    return data.access_token as string
  } catch (error) {
    logger.error(error)
    return null
  }
}

export async function getSongQueries(url: string): Promise<string[]> {
  // url can be a track, playlist, album
  // https://open.spotify.com/track/2t1G0rDxUY9zjML3f5mObb?si=VaqQxfaeTNOsqdAGfF8GdQ
  // https://open.spotify.com/album/3nE97EZ0zIx760XlDczMo7?si=amHB3A91TSaDQTSjUmw12g
  // https://open.spotify.com/playlist/37i9dQZF1E367ZqgzQj2dv?si=oa6Zp83XRcq_DrJrSow5bA
  // https://open.spotify.com/artist/6ul6vL8Hg5jTulDi0Ac8ao?si=gXR_WyceS6adZh35-r0L_w
  try {
    const token = await getToken()
    if (!token) {
      throw new Error("spotify token error")
    }
    if (url.includes("track")) {
      // track
      const title = await getTrackQuery(url, token)
      return [title]
    }
    if (url.includes("artist")) {
      // artist
      const titles = await getArtistQuery(url, token)
      return titles
    }
    if (url.includes("album")) {
      // album
      const titles = await getAlbumQuery(url, token)
      return titles
    }
    if (url.includes("playlist")) {
      // playlist
      const titles = await getPlaylistQuery(url, token)
      return titles
    }
  } catch (error) {
    logger.error(error)
    logger.error(error.message)
  }
  return []
}

export async function getTrackQuery(url: string, token: string): Promise<string> {
  const trackId = url.split("track")[1].slice(1)
  logger.info("getting track info")
  const { data } = await axios.get<Track>(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!data.artists) {
    // just name
    const title = `${data.name}`
    return title
  }
  const artist = data.artists[0]
  const title = `${artist.name} - ${data.name}`
  return title
}

export async function getArtistQuery(url: string, token: string): Promise<string[]> {
  const artistId = url.split("artist")[1].split("?")[0].slice(1)
  const { data } = await axios.get<TopTracks>(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?country=DE`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const titles = []
  for (let i = 0; i < data.tracks.length; i++) {
    const track = data.tracks[i]
    const title = `${track.artists![0].name} - ${track.name}`
    titles.push(title)
  }
  return titles
}

export async function getAlbumQuery(url: string, token: string): Promise<string[]> {
  const albumId = url.split("album")[1].split("?")[0].slice(1)
  const { data } = await axios.get<Album>(`https://api.spotify.com/v1/albums/${albumId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const titles: string[] = []
  if (!data.tracks) {
    return titles
  }
  for (let i = 0; i < data.tracks.items.length; i++) {
    const track = data.tracks.items[i]
    const title = `${data.artists![0].name} - ${track.name}`
    titles.push(title)
  }
  return titles
}

export async function getPlaylistQuery(url: string, token: string): Promise<string[]> {
  const playlistId = url.split("playlist")[1].split("?")[0].slice(1)
  const { data } = await axios.get<Playlist>(`https://api.spotify.com/v1/playlists/${playlistId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const titles: string[] = []
  if (!data.tracks) {
    return titles
  }
  for (let i = 0; i < data.tracks.items!.length; i++) {
    const { track } = data.tracks.items![i]
    const title = `${track.artists![0].name} - ${track.name}`
    titles.push(title)
  }
  return titles
}

export async function searchForTrack(query: string): Promise<Track[] | null> {
  if (query.includes("(")) {
    // eslint-disable-next-line prefer-destructuring
    query = query.split("(")[0]
  }
  if (query.includes("[")) {
    // eslint-disable-next-line prefer-destructuring
    query = query.split("[")[0]
  }
  const token = await getToken()
  const { data } = await axios.get<{ tracks: { items: Track[] } }>(
    `https://api.spotify.com/v1/search/?q=${encodeURI(query)}&type=track&limit=1`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  // first one should be the best match
  const track = data.tracks.items[0]
  if (!track || !track.artists) return null
  const artistId = track.artists[0].id
  const { data: artistDetail } = await axios.get<ArtistsEntity>(`https://api.spotify.com/v1/artists/${artistId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const { genres } = artistDetail
  if (!genres) return null
  const { data: recommended } = await axios.get<{ tracks: Track[] }>(
    `https://api.spotify.com/v1/recommendations?limit=10&market=DE&seed_artists=${artistId}&seed_genres=${encodeURI(
      genres.join(",").slice(0, 5),
    )}&seed_tracks=${track.id}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  return recommended.tracks
}
