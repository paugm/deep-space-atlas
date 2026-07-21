import type {
  CaveBrush,
  CaveChunkCoordinate,
} from "./caves.ts";

export type CaveWorkerRequest =
  | {
      kind: "initialize";
      heights: Float32Array;
      surfaceColors: Float32Array;
      caveColor: readonly [number, number, number];
    }
  | {
      kind: "mesh";
      key: string;
      revision: number;
      coordinate: CaveChunkCoordinate;
      brushes: CaveBrush[];
      includeSurface: boolean;
    };

export type CaveWorkerResponse =
  | { kind: "ready" }
  | {
      kind: "mesh";
      key: string;
      revision: number;
      positions: Float32Array;
      normals: Float32Array;
      colors: Float32Array;
    }
  | {
      kind: "error";
      key: string | null;
      revision: number | null;
      message: string;
    };
