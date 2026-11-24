"use client";

import { createContext } from "react";

export const RecordingPlaybackContext = createContext<{
    currentTime: number;
    seekToTime: (seconds: number) => void;
} | null>(null);
