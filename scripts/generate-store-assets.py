from PIL import Image, ImageDraw, ImageFont
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "store-assets"
OUT.mkdir(exist_ok=True)

FONT_REGULAR = Path("C:/Windows/Fonts/msjh.ttc")
FONT_BOLD = Path("C:/Windows/Fonts/msjhbd.ttc")


def font(size, bold=False):
    path = FONT_BOLD if bold and FONT_BOLD.exists() else FONT_REGULAR
    return ImageFont.truetype(str(path), size=size)


def text(draw, xy, value, size=28, fill="#17202a", bold=False, anchor=None):
    draw.text(xy, value, font=font(size, bold), fill=fill, anchor=anchor)


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def chip(draw, xy, value, fill, outline, color="#0f172a", size=24):
    x, y = xy
    f = font(size, True)
    bbox = draw.textbbox((0, 0), value, font=f)
    w = bbox[2] - bbox[0] + 28
    h = bbox[3] - bbox[1] + 18
    rounded(draw, (x, y, x + w, y + h), 10, fill, outline)
    draw.text((x + 14, y + 7), value, font=f, fill=color)
    return x + w + 12


def wrapped(draw, xy, value, max_width, size=28, fill="#334155", bold=False, line_gap=10):
    f = font(size, bold)
    x, y = xy
    line = ""
    for char in value:
        test = line + char
        if draw.textlength(test, font=f) <= max_width:
            line = test
        else:
            draw.text((x, y), line, font=f, fill=fill)
            y += size + line_gap
            line = char
    if line:
        draw.text((x, y), line, font=f, fill=fill)
    return y + size


def icon(draw, x, y, size):
    rounded(draw, (x, y, x + size, y + size), int(size * 0.22), "#157bd1")
    pad = int(size * 0.18)
    page = (x + pad, y + pad, x + size - pad, y + size - pad)
    rounded(draw, page, int(size * 0.08), "#ffffff")
    sx = x + int(size * 0.33)
    sy = y + int(size * 0.35)
    draw.line((sx, sy, sx + int(size * 0.34), sy), fill="#157bd1", width=max(2, int(size * 0.04)))
    draw.line((sx, sy + int(size * 0.14), sx + int(size * 0.25), sy + int(size * 0.14)), fill="#157bd1", width=max(2, int(size * 0.04)))
    draw.polygon(
        [
            (x + int(size * 0.29), y + int(size * 0.69)),
            (x + int(size * 0.72), y + int(size * 0.69)),
            (x + int(size * 0.62), y + int(size * 0.80)),
            (x + int(size * 0.39), y + int(size * 0.80)),
        ],
        fill="#f59e0b",
    )


def save_rgb(image, filename):
    image.convert("RGB").save(OUT / filename, "PNG", optimize=True)


def screenshot():
    img = Image.new("RGB", (1280, 800), "#f8fafc")
    d = ImageDraw.Draw(img)

    rounded(d, (0, 0, 1280, 76), 0, "#ffffff", "#dbe3ea")
    icon(d, 28, 18, 40)
    text(d, (82, 28), "網頁簡報器", 24, "#0f172a", True)

    controls = [
        ("啟動簡報", 190, "#e7f3ff", "#5ab4ff"),
        ("A-", 340, "#ffffff", "#d9e2ec"),
        ("32px", 402, "#ffffff", "#d9e2ec"),
        ("A+", 492, "#ffffff", "#d9e2ec"),
        ("AI 原文", 600, "#e0f2fe", "#38bdf8"),
        ("重點：開", 720, "#fff7ed", "#fdba74"),
    ]
    for label, x, fill, outline in controls:
        rounded(d, (x, 18, x + 96, 56), 12, fill, outline)
        text(d, (x + 48, 27), label, 20, "#0f172a", True, "ma")

    rounded(d, (26, 108, 250, 740), 20, "#eef3f7", "#d9e2ec")
    text(d, (52, 142), "目錄", 30, "#0f172a", True)
    toc = ["一、教務主任", "二、學務主任", "三、總務主任", "四、輔導主任", "五、人事室"]
    y = 202
    for item in toc:
        text(d, (64, y), item, 22, "#1e293b")
        y += 58

    rounded(d, (292, 108, 1238, 740), 22, "#ffffff", "#e2e8f0")
    text(d, (342, 154), "0609 主任會議", 44, "#0f172a", True)
    d.line((342, 214, 1190, 214), fill="#dbe3ea", width=2)
    text(d, (366, 258), "日期時間：115-06-09（二）08:30", 34, "#0f172a")
    text(d, (366, 318), "地點：第一會議室", 34, "#0f172a")

    text(d, (342, 410), "一、教務主任", 38, "#0f172a", True)
    d.line((342, 464, 1190, 464), fill="#dbe3ea", width=2)
    text(d, (372, 526), "1.1 教務處工作報告", 34, "#0f172a", True)
    chip(d, (372, 588), "114學年度", "#fff7ed", "#fdba74", size=26)
    chip(d, (548, 588), "學習成果", "#dbeafe", "#60a5fa", size=26)
    chip(d, (730, 588), "教務處", "#dcfce7", "#86efac", size=26)
    text(d, (372, 656), "保留原文結構，搭配 AI 重點標示，讓會議資料更容易共同閱讀。", 30, "#334155")

    save_rgb(img, "screenshot-1280x800.png")


def small_promo():
    img = Image.new("RGB", (440, 280), "#eef7ff")
    d = ImageDraw.Draw(img)
    rounded(d, (18, 18, 422, 262), 28, "#ffffff", "#cfe4f5")
    icon(d, 42, 42, 72)
    text(d, (132, 46), "網頁簡報器", 34, "#0f172a", True)
    text(d, (134, 92), "會議資料一鍵變大螢幕閱讀版", 20, "#475569")

    x = 44
    x = chip(d, (x, 152), "大字閱讀", "#e0f2fe", "#7dd3fc", size=20)
    x = chip(d, (x, 152), "目錄導覽", "#dcfce7", "#86efac", size=20)
    chip(d, (44, 204), "AI 精簡與重點標示", "#fff7ed", "#fdba74", size=20)

    save_rgb(img, "small-promo-440x280.png")


def marquee():
    img = Image.new("RGB", (1400, 560), "#0f2f4a")
    d = ImageDraw.Draw(img)
    rounded(d, (48, 48, 1352, 512), 38, "#f8fafc")
    icon(d, 96, 100, 104)
    text(d, (230, 102), "網頁簡報器", 54, "#0f172a", True)
    text(d, (232, 172), "把長篇網頁與會議資料，轉成適合大螢幕閱讀的簡報版面", 30, "#334155")

    cards = [
        ("清楚閱讀", "放大字級、整理段落，讓會議室投影更容易看。"),
        ("快速導覽", "自動產生目錄，主任會議、教師週會都能快速跳段。"),
        ("AI 重點", "可選擇精簡版或原文重點標示，結果暫存在本機。"),
    ]
    x = 96
    for title, body in cards:
        rounded(d, (x, 286, x + 370, 444), 24, "#ffffff", "#dbeafe")
        text(d, (x + 30, 318), title, 34, "#0f172a", True)
        wrapped(d, (x + 30, 370), body, 310, size=23, fill="#475569", line_gap=8)
        x += 410

    save_rgb(img, "marquee-promo-1400x560.png")


if __name__ == "__main__":
    screenshot()
    small_promo()
    marquee()
    print(OUT)
