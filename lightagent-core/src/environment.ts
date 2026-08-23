export type OSType = "windows" | "darwin" | "linux" | "android" | "freebsd" | "netbsd" | "aix" | "solaris" | "illumos"

export interface Environment {
  get: (key: string) => string | undefined
  set: (key: string, value: string) => void,
  delete: (key: string) => void,
  contains: (key: string) => boolean,
  os: () => OSType
}
