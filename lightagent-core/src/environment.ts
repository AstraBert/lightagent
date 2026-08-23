export interface Environment {
  get: (key: string) => string | undefined
  set: (key: string, value: string) => void,
  delete: (key: string) => void,
  contains: (key: string) => boolean,
}
