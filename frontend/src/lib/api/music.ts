/**
 * @Description: 音乐API - 调用后端音乐接口
 * @Author: 安知鱼
 */

import { apiClient } from "./client";
import type { Song } from "@/types/music";

// 播放列表响应接口
export interface PlaylistResponse {
  songs: Song[];
  total: number;
}

export interface SongResourcesResponse {
  audioUrl: string;
  lyricsText: string;
}

/**
 * 获取播放列表
 */
export const getPlaylistApi = () => {
  return apiClient.get<PlaylistResponse>("/api/public/music/playlist");
};

/**
 * Resolve a NetEase song through our backend so browser playback does not
 * depend on the third-party API's CORS policy.
 */
export const getSongResourcesApi = (neteaseId: string) => {
  return apiClient.post<SongResourcesResponse>("/api/public/music/song-resources", { neteaseId });
};
