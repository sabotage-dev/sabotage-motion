interface Clock { start: number; laps: number[] }
export type Lap = Readonly<Clock>;
function lap(c: Clock): number {
  return c.laps.length as number;
}
