#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///
import sys
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def get_migrations_dir() -> Path:
    return Path(__file__).parents[1] / "lightagent-core" / "src" / "migrations"


def assign_migration_name(directory: Path, name: str) -> str:
    nums: list[int] = []
    for _, _, files in directory.walk():
        for f in files:
            nums.append(int(f.split("_")[0].removeprefix("0")))
    if len(nums) > 0:
        number = str(max(nums) + 1)
        if len(number) == 1:
            return f"00{number}_{name}"
        elif len(number) == 2:
            return f"0{number}_{name}"
        return number
    return f"001_{name}"


def main() -> None:
    if len(sys.argv) < 2:
        print(
            "You should provide one positional argument to this command: MIGRATION_NAME"
        )
        sys.exit(1)
    migration_name = sys.argv[1]
    directory = get_migrations_dir()
    name = assign_migration_name(directory, migration_name)
    (directory / f"{name}.sql").touch()
    sys.exit(0)


if __name__ == "__main__":
    main()
