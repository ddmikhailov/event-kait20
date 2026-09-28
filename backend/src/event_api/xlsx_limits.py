"""Bound worksheet dimensions before openpyxl materializes sparse rectangles."""

import io
import re
import zipfile

from defusedxml.ElementTree import iterparse  # type: ignore[import-untyped]

from .errors import ApiError

MAX_GRID_CELLS = 1_000_000
MAX_GRID_ROWS = 50_000
MAX_GRID_COLUMNS = 256


def validate_sheet_grid(source: bytes) -> None:
    # Call only after the ZIP metadata preflight has bounded expanded input.
    try:
        with zipfile.ZipFile(io.BytesIO(source)) as archive:
            for name in archive.namelist():
                if not name.startswith("xl/worksheets/") or not name.endswith(".xml"):
                    continue
                max_row = max_column = cells = 0
                with archive.open(name) as stream:
                    for _, element in iterparse(stream, events=("end",)):
                        tag = element.tag.rsplit("}", 1)[-1]
                        coordinates = []
                        if tag == "c":
                            cells += 1
                            coordinates = [element.attrib.get("r", "")]
                        elif tag == "mergeCell":
                            coordinates = element.attrib.get("ref", "").split(":")
                        parsed = []
                        for coordinate in coordinates:
                            match = re.fullmatch(
                                r"([A-Z]{1,3})([1-9][0-9]{0,6})",
                                coordinate,
                            )
                            if not match:
                                raise ValueError("Invalid worksheet coordinate")
                            column = 0
                            for char in match[1]:
                                column = column * 26 + ord(char) - ord("A") + 1
                            max_column = max(max_column, column)
                            max_row = max(max_row, int(match[2]))
                            parsed.append((int(match[2]), column))
                            if (
                                max_row > MAX_GRID_ROWS
                                or max_column > MAX_GRID_COLUMNS
                                or max_row * max_column > MAX_GRID_CELLS
                                or cells > MAX_GRID_CELLS
                            ):
                                raise ApiError(
                                    400,
                                    "XLSX_GRID_TOO_LARGE",
                                    "Worksheet grid is too large",
                                )
                        if tag == "mergeCell" and len(parsed) == 2:
                            cells += (abs(parsed[1][0] - parsed[0][0]) + 1) * (
                                abs(parsed[1][1] - parsed[0][1]) + 1
                            )
                            if cells > MAX_GRID_CELLS:
                                raise ApiError(
                                    400,
                                    "XLSX_GRID_TOO_LARGE",
                                    "Merged grid is too large",
                                )
                        element.clear()
    except ApiError:
        raise
    except Exception as error:
        raise ApiError(
            400, "VALIDATION_ERROR", "XLSX workbook could not be read"
        ) from error
