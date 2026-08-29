import * as m001 from "./001_init.ts";


export const migrations = [
  { version: m001.version, sql: m001.sql },
].sort((a, b) => a.version - b.version);
