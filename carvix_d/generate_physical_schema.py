#!/usr/bin/env python3
"""Генератор физической схемы БД Carvix в SVG."""
import re

TABLE_W = 210
HEADER_H = 24
ROW_H = 18

# Данные таблиц: имя, позиция (x, y), колонки
tables_data = [
    # Col 1
    {"name": "marka", "x": 20, "y": 20, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "nazvanie", "type": "VARCHAR(255)", "pk": False}
    ]},
    {"name": "model", "x": 20, "y": 90, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "marka_id", "type": "INT", "pk": False, "fk": True},
        {"name": "nazvanie", "type": "VARCHAR(255)", "pk": False}
    ]},
    {"name": "rol", "x": 20, "y": 178, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "nazvanie", "type": "VARCHAR(255)", "pk": False}
    ]},
    {"name": "podrazdelenie", "x": 20, "y": 248, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "nazvanie", "type": "VARCHAR(255)", "pk": False}
    ]},
    # Col 2
    {"name": "sotrudnik", "x": 260, "y": 20, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "fio", "type": "VARCHAR(255)", "pk": False},
        {"name": "login", "type": "VARCHAR(100)", "pk": False},
        {"name": "parol_hash", "type": "VARCHAR(255)", "pk": False},
        {"name": "rol_id", "type": "INT", "pk": False, "fk": True},
        {"name": "podrazdelenie_id", "type": "INT", "pk": False, "fk": True}
    ]},
    {"name": "transportnoe_sredstvo", "x": 260, "y": 162, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "gos_nomer", "type": "VARCHAR(50)", "pk": False},
        {"name": "invent_nomer", "type": "VARCHAR(50)", "pk": False},
        {"name": "model_id", "type": "INT", "pk": False, "fk": True},
        {"name": "podrazdelenie_id", "type": "INT", "pk": False, "fk": True},
        {"name": "probeg", "type": "INT", "pk": False},
        {"name": "data_vypuska", "type": "DATE", "pk": False},
        {"name": "tekuschee_sost.", "type": "VARCHAR(100)", "pk": False},
        {"name": "sozdatel_id", "type": "INT", "pk": False, "fk": True}
    ]},
    {"name": "status", "x": 260, "y": 358, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "nazvanie", "type": "VARCHAR(100)", "pk": False}
    ]},
    {"name": "tip_remonta", "x": 260, "y": 428, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "nazvanie", "type": "VARCHAR(100)", "pk": False},
        {"name": "kategoriya", "type": "VARCHAR(100)", "pk": False}
    ]},
    {"name": "postavshik", "x": 260, "y": 516, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "nazvanie", "type": "VARCHAR(255)", "pk": False},
        {"name": "kontakty", "type": "VARCHAR(255)", "pk": False},
        {"name": "adres", "type": "VARCHAR(255)", "pk": False}
    ]},
    # Col 3
    {"name": "zayavka", "x": 500, "y": 20, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "data_sozdaniya", "type": "TIMESTAMP", "pk": False},
        {"name": "sozdatel_id", "type": "INT", "pk": False, "fk": True},
        {"name": "ts_id", "type": "INT", "pk": False, "fk": True},
        {"name": "tip_remonta_id", "type": "INT", "pk": False, "fk": True},
        {"name": "opisanie", "type": "TEXT", "pk": False},
        {"name": "status_id", "type": "INT", "pk": False, "fk": True},
        {"name": "prioritet", "type": "INT", "pk": False},
        {"name": "data_rezhima", "type": "TIMESTAMP", "pk": False}
    ]},
    {"name": "remont", "x": 500, "y": 216, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "zayavka_id", "type": "INT", "pk": False, "fk": True},
        {"name": "data_nachala", "type": "TIMESTAMP", "pk": False},
        {"name": "data_okonchaniya", "type": "TIMESTAMP", "pk": False},
        {"name": "mekhanik_id", "type": "INT", "pk": False, "fk": True},
        {"name": "gl_mekhanik_id", "type": "INT", "pk": False, "fk": True},
        {"name": "stoimost_rabot", "type": "NUMERIC", "pk": False},
        {"name": "stoimost_zapch.", "type": "NUMERIC", "pk": False},
        {"name": "kommentariy", "type": "TEXT", "pk": False},
        {"name": "itog", "type": "VARCHAR(255)", "pk": False},
        {"name": "garantiya_do", "type": "DATE", "pk": False}
    ]},
    {"name": "zapchast", "x": 500, "y": 448, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "naimenovanie", "type": "VARCHAR(255)", "pk": False},
        {"name": "artikul", "type": "VARCHAR(100)", "pk": False},
        {"name": "postavshik_id", "type": "INT", "pk": False, "fk": True},
        {"name": "tsena", "type": "NUMERIC(10,2)", "pk": False},
        {"name": "ostatok", "type": "INT", "pk": False},
        {"name": "kategoriya", "type": "VARCHAR(100)", "pk": False}
    ]},
    {"name": "byudzhet", "x": 500, "y": 608, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "podrazdelenie_id", "type": "INT", "pk": False, "fk": True},
        {"name": "god", "type": "INT", "pk": False},
        {"name": "mesyats", "type": "INT", "pk": False},
        {"name": "kategoriya", "type": "VARCHAR(50)", "pk": False},
        {"name": "plan_summa", "type": "NUMERIC(12,2)", "pk": False}
    ]},
    {"name": "prochiy_raskhod", "x": 500, "y": 750, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "ts_id", "type": "INT", "pk": False, "fk": True},
        {"name": "podrazdelenie_id", "type": "INT", "pk": False, "fk": True},
        {"name": "data", "type": "DATE", "pk": False},
        {"name": "kategoriya", "type": "VARCHAR(50)", "pk": False},
        {"name": "summa", "type": "NUMERIC(10,2)", "pk": False},
        {"name": "opisanie", "type": "TEXT", "pk": False}
    ]},
    # Col 4
    {"name": "zayavka_status_istoriya", "x": 740, "y": 20, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "zayavka_id", "type": "INT", "pk": False, "fk": True},
        {"name": "status_id", "type": "INT", "pk": False, "fk": True},
        {"name": "status_nazvanie", "type": "VARCHAR(100)", "pk": False},
        {"name": "sotrudnik_id", "type": "INT", "pk": False, "fk": True},
        {"name": "sotrudnik_fio", "type": "VARCHAR(255)", "pk": False},
        {"name": "data_izmeneniya", "type": "TIMESTAMP", "pk": False},
        {"name": "kommentariy", "type": "TEXT", "pk": False}
    ]},
    {"name": "ispolzovanie_zapchastey", "x": 740, "y": 198, "cols": [
        {"name": "remont_id", "type": "INT", "pk": True, "fk": True},
        {"name": "zapchast_id", "type": "INT", "pk": True, "fk": True},
        {"name": "kolichestvo", "type": "INT", "pk": False},
        {"name": "tsena_na_moment", "type": "NUMERIC(10,2)", "pk": False}
    ]},
    {"name": "vlozhenie", "x": 740, "y": 304, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "zayavka_id", "type": "INT", "pk": False, "fk": True},
        {"name": "remont_id", "type": "INT", "pk": False, "fk": True},
        {"name": "put_faila", "type": "VARCHAR(255)", "pk": False},
        {"name": "tip_faila", "type": "VARCHAR(50)", "pk": False},
        {"name": "data_zagruzki", "type": "TIMESTAMP", "pk": False}
    ]},
    {"name": "soobscheniye", "x": 740, "y": 446, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "zayavka_id", "type": "INT", "pk": False, "fk": True},
        {"name": "otpravitel_id", "type": "INT", "pk": False, "fk": True},
        {"name": "tekst", "type": "TEXT", "pk": False},
        {"name": "data_otpravki", "type": "TIMESTAMP", "pk": False}
    ]},
    {"name": "prikhod_zapchasti", "x": 740, "y": 570, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "postavshik_id", "type": "INT", "pk": False, "fk": True},
        {"name": "data_prikhoda", "type": "DATE", "pk": False},
        {"name": "nomer_nakl", "type": "VARCHAR(50)", "pk": False},
        {"name": "summa_obshaya", "type": "NUMERIC(12,2)", "pk": False},
        {"name": "kommentariy", "type": "TEXT", "pk": False},
        {"name": "sozdatel_id", "type": "INT", "pk": False, "fk": True}
    ]},
    {"name": "finansoviy_log", "x": 740, "y": 730, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "data_operatsii", "type": "TIMESTAMP", "pk": False},
        {"name": "sotrudnik_id", "type": "INT", "pk": False, "fk": True},
        {"name": "tip_operatsii", "type": "VARCHAR(50)", "pk": False},
        {"name": "obyekt_tablitsa", "type": "VARCHAR(50)", "pk": False},
        {"name": "obyekt_id", "type": "INT", "pk": False},
        {"name": "summa", "type": "NUMERIC(12,2)", "pk": False},
        {"name": "kommentariy", "type": "TEXT", "pk": False}
    ]},
    # Col 5
    {"name": "prikhod_zapchasti_pozitsii", "x": 980, "y": 570, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "prikhod_id", "type": "INT", "pk": False, "fk": True},
        {"name": "zapchast_id", "type": "INT", "pk": False, "fk": True},
        {"name": "kolichestvo", "type": "INT", "pk": False},
        {"name": "tsena_za_edinicu", "type": "NUMERIC(10,2)", "pk": False}
    ]},
    {"name": "tarif_rabot", "x": 980, "y": 730, "cols": [
        {"name": "id", "type": "SERIAL", "pk": True},
        {"name": "tip_remonta_id", "type": "INT", "pk": False, "fk": True},
        {"name": "tsena_za_chas", "type": "NUMERIC(10,2)", "pk": False},
        {"name": "data_s", "type": "DATE", "pk": False},
        {"name": "data_po", "type": "DATE", "pk": False}
    ]},
    {"name": "remont_normy", "x": 980, "y": 844, "cols": [
        {"name": "remont_id", "type": "INT", "pk": True, "fk": True},
        {"name": "mekhanik_id", "type": "INT", "pk": True, "fk": True},
        {"name": "chasy", "type": "NUMERIC(5,2)", "pk": False},
        {"name": "tarif_id", "type": "INT", "pk": False, "fk": True}
    ]},
]

relations = [
    ("marka", "id", "model", "marka_id"),
    ("model", "id", "transportnoe_sredstvo", "model_id"),
    ("podrazdelenie", "id", "sotrudnik", "podrazdelenie_id"),
    ("podrazdelenie", "id", "transportnoe_sredstvo", "podrazdelenie_id"),
    ("podrazdelenie", "id", "byudzhet", "podrazdelenie_id"),
    ("podrazdelenie", "id", "prochiy_raskhod", "podrazdelenie_id"),
    ("rol", "id", "sotrudnik", "rol_id"),
    ("sotrudnik", "id", "zayavka", "sozdatel_id"),
    ("sotrudnik", "id", "transportnoe_sredstvo", "sozdatel_id"),
    ("sotrudnik", "id", "remont", "mekhanik_id"),
    ("sotrudnik", "id", "remont", "gl_mekhanik_id"),
    ("sotrudnik", "id", "zayavka_status_istoriya", "sotrudnik_id"),
    ("sotrudnik", "id", "prikhod_zapchasti", "sozdatel_id"),
    ("sotrudnik", "id", "finansoviy_log", "sotrudnik_id"),
    ("sotrudnik", "id", "soobscheniye", "otpravitel_id"),
    ("sotrudnik", "id", "remont_normy", "mekhanik_id"),
    ("transportnoe_sredstvo", "id", "zayavka", "ts_id"),
    ("transportnoe_sredstvo", "id", "prochiy_raskhod", "ts_id"),
    ("status", "id", "zayavka", "status_id"),
    ("status", "id", "zayavka_status_istoriya", "status_id"),
    ("tip_remonta", "id", "zayavka", "tip_remonta_id"),
    ("tip_remonta", "id", "tarif_rabot", "tip_remonta_id"),
    ("postavshik", "id", "zapchast", "postavshik_id"),
    ("postavshik", "id", "prikhod_zapchasti", "postavshik_id"),
    ("zapchast", "id", "ispolzovanie_zapchastey", "zapchast_id"),
    ("zapchast", "id", "prikhod_zapchasti_pozitsii", "zapchast_id"),
    ("zayavka", "id", "remont", "zayavka_id"),
    ("zayavka", "id", "zayavka_status_istoriya", "zayavka_id"),
    ("zayavka", "id", "vlozhenie", "zayavka_id"),
    ("zayavka", "id", "soobscheniye", "zayavka_id"),
    ("remont", "id", "ispolzovanie_zapchastey", "remont_id"),
    ("remont", "id", "vlozhenie", "remont_id"),
    ("remont", "id", "remont_normy", "remont_id"),
    ("prikhod_zapchasti", "id", "prikhod_zapchasti_pozitsii", "prikhod_id"),
    ("tarif_rabot", "id", "remont_normy", "tarif_id"),
]

tables_map = {t["name"]: t for t in tables_data}


def get_field_y(table, col_name):
    for i, col in enumerate(table["cols"]):
        if col["name"] == col_name:
            return table["y"] + HEADER_H + (i + 1) * ROW_H - 5
    return table["y"] + HEADER_H + ROW_H - 5


def table_height(t):
    return HEADER_H + len(t["cols"]) * ROW_H


def manhattan_path(t1_name, c1_name, t2_name, c2_name):
    t1 = tables_map[t1_name]
    t2 = tables_map[t2_name]
    y1 = get_field_y(t1, c1_name)
    y2 = get_field_y(t2, c2_name)

    # Стрелка указывает на t2 (FK side)
    if t1["x"] + TABLE_W < t2["x"]:
        x1 = t1["x"] + TABLE_W
        x2 = t2["x"]
        mid_x = x1 + (x2 - x1) / 2
        return f"M {x1},{y1} L {mid_x},{y1} L {mid_x},{y2} L {x2},{y2}"
    elif t2["x"] + TABLE_W < t1["x"]:
        x1 = t1["x"]
        x2 = t2["x"] + TABLE_W
        mid_x = x2 + (x1 - x2) / 2
        return f"M {x1},{y1} L {mid_x},{y1} L {mid_x},{y2} L {x2},{y2}"
    else:
        # same column
        x1 = t1["x"] + TABLE_W / 2
        x2 = t2["x"] + TABLE_W / 2
        if y1 < y2:
            mid_y = y1 + (y2 - y1) / 2
            return f"M {x1},{y1} L {x1},{mid_y} L {x2},{mid_y} L {x2},{y2}"
        else:
            mid_y = y2 + (y1 - y2) / 2
            return f"M {x1},{y1} L {x1},{mid_y} L {x2},{mid_y} L {x2},{y2}"


def build_svg():
    lines = []
    lines.append('<?xml version="1.0" encoding="UTF-8"?>')
    lines.append('<svg xmlns="http://www.w3.org/2000/svg" width="1250" height="990" viewBox="0 0 1250 990">')
    lines.append('<defs>')
    lines.append('  <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">')
    lines.append('    <path d="M0,0 L0,6 L9,3 z" fill="#000000"/>')
    lines.append('  </marker>')
    lines.append('</defs>')

    # Background
    lines.append('<rect x="0" y="0" width="1250" height="990" fill="#ffffff"/>')

    # Title
    lines.append('<text x="625" y="16" font-family="Times New Roman, serif" font-size="14" text-anchor="middle" fill="#000000">Рисунок 2.1 — Физическая схема базы данных системы Carvix</text>')

    # Relations (draw first so they appear behind tables)
    for r in relations:
        path_d = manhattan_path(*r)
        lines.append(f'<path d="{path_d}" fill="none" stroke="#555555" stroke-width="1" marker-end="url(#arrow)"/>')

    # Tables
    for t in tables_data:
        tx, ty = t["x"], t["y"]
        th = table_height(t)

        # table border
        lines.append(f'<rect x="{tx}" y="{ty}" width="{TABLE_W}" height="{th}" fill="#ffffff" stroke="#000000" stroke-width="1.5"/>')
        # header background
        lines.append(f'<rect x="{tx}" y="{ty}" width="{TABLE_W}" height="{HEADER_H}" fill="#e8e8e8" stroke="#000000" stroke-width="1.5"/>')
        # header text
        lines.append(f'<text x="{tx + TABLE_W/2}" y="{ty + HEADER_H - 6}" font-family="Arial, sans-serif" font-size="12" font-weight="bold" text-anchor="middle" fill="#000000">{t["name"]}</text>')

        # columns
        for i, col in enumerate(t["cols"]):
            cy = ty + HEADER_H + (i + 1) * ROW_H - 5
            name_text = col["name"]
            type_text = col["type"]

            # field name
            is_bold = "font-weight=\"bold\"" if col.get("pk") else ""
            lines.append(f'<text x="{tx + 6}" y="{cy}" font-family="Arial, sans-serif" font-size="10" {is_bold} fill="#000000">{name_text}</text>')

            # type + constraint on the right
            constraint = ""
            if col.get("pk") and col.get("fk"):
                constraint = "PK, FK"
            elif col.get("pk"):
                constraint = "PK"
            elif col.get("fk"):
                constraint = "FK"

            right_text = f"{type_text} {constraint}".strip()
            lines.append(f'<text x="{tx + TABLE_W - 6}" y="{cy}" font-family="Arial, sans-serif" font-size="9" text-anchor="end" fill="#333333">{right_text}</text>')

    # Legend
    lx, ly = 20, 960
    lines.append(f'<text x="{lx}" y="{ly}" font-family="Arial, sans-serif" font-size="10" fill="#000000">PK — первичный ключ    FK — внешний ключ</text>')
    lines.append(f'<text x="{lx}" y="{ly + 14}" font-family="Arial, sans-serif" font-size="10" fill="#000000">Стрелки направлены от родительской таблицы (PK) к дочерней (FK)</text>')

    lines.append('</svg>')
    return "\n".join(lines)


if __name__ == "__main__":
    svg = build_svg()
    out_path = "/Users/slavaivanov/PycharmProjects/diplom/carvix_d/diagram_physical_schema.svg"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(svg)
    print(f"SVG сохранён: {out_path}")
