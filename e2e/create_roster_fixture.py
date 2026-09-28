"""Write one fictional student for the isolated browser journey."""

import sys

from openpyxl import Workbook


def main() -> None:
    output, surname = sys.argv[1:3]
    workbook = Workbook()
    workbook.active.append(["Фамилия", "Имя", "Отчество", "Группа"])
    workbook.active.append([surname, "Тест", "Петрович", "E2E-MOS"])
    workbook.save(output)
    workbook.close()


if __name__ == "__main__":
    main()
