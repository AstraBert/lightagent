#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///
#
# pyright: basic
import sys
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def get_migrations_dir() -> Path:
    return Path(__file__).parents[1] / "lightagent-core" / "src" / "migrations"

def get_str_repr(number: int) -> str:
    num = str(number)
    if len(num) == 1:
        return f"00{number}"
    elif len(num) == 2:
        return f"0{number}"
    return num

def assign_migration_name(directory: Path, name: str) -> tuple[str, int]:
    nums: list[int] = []
    for _, _, files in directory.walk():
        for f in files:
            if f == "mod.ts":
                continue
            nums.append(int(f.split("_")[0].removeprefix("0")))
    if len(nums) > 0:
        number = max(nums) + 1
        return f"{get_str_repr(number)}_{name}", number
    return f"001_{name}", 1


def main() -> None:
    if len(sys.argv) < 2:
        print(
            "You should provide one positional argument to this command: MIGRATION_NAME"
        )
        sys.exit(1)
    migration_name = sys.argv[1]
    directory = get_migrations_dir()
    name, version = assign_migration_name(directory, migration_name)
    with open(directory / f"{name}.ts", "w") as f:
        towrite = f"export const version = {version}\n\nexport const sql = ``"
        _ = f.write(towrite)
    with open(directory / "mod.ts") as f:
        lines = f.readlines()
    with open(directory / "mod.ts", "w") as f:
        for (i, line) in enumerate(lines):
            if i < len(lines) and line.startswith("import") and not lines[i+1].startswith("import"):
                f.write(line)
                f.write(f"import * as m{get_str_repr(version)} from \"./{name}.ts\"\n\n")
            elif line.startswith("].sort((a, b) => a.version - b.version);"):
                f.write("\t{ version: " + f"m{get_str_repr(version)}.version, sql: m{get_str_repr(version)}.sql " + "},\n")
                f.write(line)
            else:
                f.write(line)

    sys.exit(0)


if __name__ == "__main__":
    main()
