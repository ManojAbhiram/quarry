"""Build the customer guide using Quarry's original branded PDF design.

From the repository root on Windows:
    apps/api/.venv/Scripts/python.exe docs/product/build_product_guide.py

Requires ReportLab (included in the API dependencies) and Segoe UI/Consolas.
Use --font-dir for a directory containing segoeui.ttf, segoeuib.ttf, and consola.ttf.
"""
from __future__ import annotations

import argparse
import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, PageBreak, PageTemplate, Paragraph,
    Spacer, Table, TableStyle, Preformatted,
)
from reportlab.platypus.tableofcontents import TableOfContents

HERE = Path(__file__).resolve().parent
WIDTH, HEIGHT = A4
MARGIN = 47
CONTENT = WIDTH - 2 * MARGIN
NAVY = colors.HexColor('#0f172a')
COVER = colors.HexColor('#072a38')
TEXT = colors.HexColor('#203445')
MUTED = colors.HexColor('#526777')
CYAN = colors.HexColor('#22d3ee')
TEAL = colors.HexColor('#0e7490')
PALE = colors.HexColor('#ecfeff')
LINE = colors.HexColor('#d8e5ea')


def inline(text: str) -> str:
    text = html.escape(text.replace('\\|', '|'))
    text = re.sub(r'`([^`]+)`', r'<font name="Consolas" size="9">\1</font>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', text)
    # PDF links remain clickable for web destinations; repository links keep their label.
    def link(match):
        label, url = match.groups()
        return f'<link href="{url}" color="#0e7490">{label}</link>' if url.startswith(('https://', 'http://')) else label
    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link, text)


def logo(canvas, x, y, size, color=NAVY, outline=False):
    canvas.saveState()
    canvas.translate(x, y)
    canvas.scale(size / 64, -size / 64)
    canvas.setLineWidth(.45)
    for points, fill in [
        ([(20, 4), (36, 4), (52, 20), (52, 38), (40, 26), (40, 24), (32, 16),
          (24, 16), (16, 24), (16, 32), (24, 40), (26, 40), (38, 52), (20, 52), (4, 36), (4, 20)], color),
        ([(32, 24), (60, 52), (60, 60), (52, 60), (24, 32)], CYAN),
    ]:
        path = canvas.beginPath()
        path.moveTo(*points[0])
        for point in points[1:]:
            path.lineTo(*point)
        path.close()
        canvas.setFillColor(fill)
        canvas.setStrokeColor(CYAN if outline else fill)
        canvas.drawPath(path, stroke=int(outline), fill=int(not outline))
    canvas.restoreState()


class Chapter(Paragraph):
    def draw(self):
        self.canv.saveState()
        self.canv.setStrokeColor(CYAN)
        self.canv.setLineWidth(2)
        self.canv.line(0, self.height + 8, 28, self.height + 8)
        self.canv.restoreState()
        super().draw()


class Workflow(Flowable):
    """The original guide's numbered cyan workflow boxes, drawn as vectors."""
    def __init__(self, source, styles):
        super().__init__()
        self.labels = re.findall(r'\w+\["(.*?)"\]', source)
        if not self.labels:
            raise ValueError('Unsupported workflow diagram; expected quoted node labels.')
        self.styles = styles
        self.width = CONTENT
        self.height = 68

    def draw(self):
        canvas = self.canv
        count = len(self.labels)
        gap = 18
        box_width = (self.width - gap * (count - 1)) / count
        paragraphs = [Paragraph(label.replace('<br/>', '<br/>'), self.styles['diagram']) for label in self.labels]
        sizes = [paragraph.wrap(box_width - 14, 1000)[1] for paragraph in paragraphs]
        height = max(61, max(sizes) + 30)
        for i, (paragraph, pheight) in enumerate(zip(paragraphs, sizes)):
            x = i * (box_width + gap)
            canvas.setFillColor(PALE)
            canvas.setStrokeColor(colors.HexColor('#95ccda'))
            canvas.setLineWidth(.8)
            canvas.roundRect(x, 0, box_width, height, 3.5, fill=1, stroke=1)
            canvas.setFillColor(TEAL)
            canvas.setFont('Segoe-Bold', 7.2)
            canvas.drawCentredString(x + box_width / 2, height - 12, f'{i + 1:02}')
            paragraph.drawOn(canvas, x + 7, 9)
            if i < count - 1:
                canvas.setStrokeColor(TEAL)
                canvas.setFillColor(TEAL)
                canvas.setLineWidth(1)
                canvas.line(x + box_width + 2.5, height / 2, x + box_width + gap - 6.2, height / 2)
                path = canvas.beginPath()
                path.moveTo(x + box_width + gap - 2, height / 2)
                path.lineTo(x + box_width + gap - 6.2, height / 2 + 2.7)
                path.lineTo(x + box_width + gap - 6.2, height / 2 - 2.7)
                path.close()
                canvas.drawPath(path, fill=1, stroke=0)


class Guide(BaseDocTemplate):
    def __init__(self, output, styles):
        super().__init__(str(output), pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=69, bottomMargin=52, title='Quarry Customer Guide',
                         author='Quarry', subject='Quarry customer guide')
        self.styles = styles
        self.chapter = 'Contents'
        frame = Frame(MARGIN, 52, CONTENT, HEIGHT - 121, leftPadding=0, rightPadding=0,
                      topPadding=0, bottomPadding=0)
        self.addPageTemplates(PageTemplate('guide', [frame], onPage=self.page_start, onPageEnd=self.page_end))

    def beforeDocument(self):
        self.chapter = 'Contents'

    def page_start(self, canvas, doc):
        if doc.page != 1:
            return
        canvas.saveState()
        canvas.setFillColor(COVER)
        canvas.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)
        logo(canvas, 44, HEIGHT - 53, 37, colors.white)
        canvas.setFillColor(colors.white)
        canvas.setFont('Segoe-Bold', 21)
        canvas.drawString(92, HEIGHT - 80, 'Quarry')
        canvas.setStrokeColor(CYAN)
        canvas.setLineWidth(2)
        canvas.line(47, HEIGHT - 159, 111, HEIGHT - 159)
        canvas.setFont('Segoe-Bold', 49)
        canvas.drawString(45, HEIGHT - 241, 'Customer')
        canvas.drawString(45, HEIGHT - 301, 'Guide')
        subtitle = Paragraph('From your first search to confident outreach. A practical guide '
                             'to finding, reviewing, organizing, and engaging the right companies.', self.styles['cover'])
        _, height = subtitle.wrap(470, 200)
        subtitle.drawOn(canvas, 47, HEIGHT - 360 - height + 17)
        logo(canvas, WIDTH - 223, 316, 176, colors.white, outline=True)
        canvas.setStrokeColor(colors.HexColor('#36556c'))
        canvas.setLineWidth(.45)
        canvas.line(47, 101, WIDTH - 47, 101)
        canvas.setFillColor(colors.HexColor('#d7eaf1'))
        canvas.setFont('Segoe', 10)
        canvas.drawString(47, 75, 'Customer Guide')
        canvas.drawRightString(WIDTH - 47, 75, 'November 2026')
        canvas.restoreState()

    def page_end(self, canvas, doc):
        if doc.page == 1:
            return
        canvas.saveState()
        logo(canvas, 46, HEIGHT - 27, 13)
        canvas.setFillColor(NAVY)
        canvas.setFont('Segoe-Bold', 8.2)
        canvas.drawString(65, HEIGHT - 37, 'Quarry')
        canvas.setFillColor(MUTED)
        canvas.setFont('Segoe', 8)
        canvas.drawString(104, HEIGHT - 37, 'Customer guide')
        canvas.drawRightString(WIDTH - 47, HEIGHT - 37, self.chapter)
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(.6)
        canvas.line(47, HEIGHT - 47, WIDTH - 47, HEIGHT - 47)
        canvas.line(47, 40, WIDTH - 47, 40)
        canvas.drawString(47, 25, 'Customer Guide')
        canvas.drawCentredString(WIDTH / 2, 25, 'November 2026')
        canvas.setFillColor(NAVY)
        canvas.setFont('Segoe-Bold', 9)
        canvas.drawRightString(WIDTH - 47, 24, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if not hasattr(flowable, 'bookmark'):
            return
        text = flowable.getPlainText()
        self.canv.bookmarkPage(flowable.bookmark)
        level = 0 if isinstance(flowable, Chapter) else 1
        self.canv.addOutlineEntry(text, flowable.bookmark, level=level, closed=False)
        if level == 0:
            self.chapter = text
            self.notify('TOCEntry', (0, text, self.page, flowable.bookmark))


def table(rows, styles):
    cells = [re.split(r'(?<!\\)\|', row.strip().strip('|')) for row in rows]
    cells = [row for row in cells if not all(re.fullmatch(r'\s*:?-+:?\s*', cell) for cell in row)]
    count = len(cells[0])
    # Size columns from text lengths, with a floor so short labels remain readable.
    weights = [max(12, min(60, max(len(re.sub(r'[*`]', '', row[i])) for row in cells))) for i in range(count)]
    widths = [CONTENT * w / sum(weights) for w in weights]
    if count == 3:
        widths = [171.3293, 146.7451, CONTENT - 318.0744]
    data = [[Paragraph(inline(cell.strip()), styles['th' if n == 0 else 'td']) for cell in row] for n, row in enumerate(cells)]
    result = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT', spaceBefore=2, spaceAfter=12)
    result.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, PALE]),
        ('LINEBELOW', (0, 0), (-1, 0), 1, CYAN),
        ('LINEBELOW', (0, 1), (-1, -1), .35, LINE),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 6.5),
    ]))
    return result


def build(source, output, font_dir):
    for name, filename in [('Segoe', 'segoeui.ttf'), ('Segoe-Bold', 'segoeuib.ttf'), ('Consolas', 'consola.ttf')]:
        pdfmetrics.registerFont(TTFont(name, str(font_dir / filename)))
    pdfmetrics.registerFontFamily('Segoe', normal='Segoe', bold='Segoe-Bold', italic='Segoe', boldItalic='Segoe-Bold')
    base = ParagraphStyle('body', fontName='Segoe', fontSize=10.5, leading=14.8, textColor=TEXT, spaceAfter=8)
    styles = {
        'body': base,
        'chapter': ParagraphStyle('chapter', parent=base, fontName='Segoe-Bold', fontSize=22, leading=27, textColor=NAVY, spaceBefore=18, spaceAfter=12, keepWithNext=True),
        'section': ParagraphStyle('section', parent=base, fontName='Segoe-Bold', fontSize=12.8, leading=16.6, textColor=NAVY, spaceBefore=10, spaceAfter=7, keepWithNext=True),
        'cover': ParagraphStyle('cover', parent=base, fontSize=17, leading=24, textColor=colors.HexColor('#d7eaf1')),
        'td': ParagraphStyle('td', parent=base, fontSize=9.6, leading=13, spaceAfter=0),
        'th': ParagraphStyle('th', parent=base, fontName='Segoe-Bold', fontSize=9.5, leading=12.7, textColor=colors.white, spaceAfter=0),
        'diagram': ParagraphStyle('diagram', parent=base, fontName='Segoe-Bold', fontSize=9.5, leading=12.5, alignment=TA_CENTER, spaceAfter=0),
        'list': ParagraphStyle('list', parent=base, leftIndent=20, firstLineIndent=0, bulletIndent=1, bulletFontName='Segoe-Bold', bulletFontSize=9.5, bulletColor=TEAL, spaceAfter=5.2),
        'toc': ParagraphStyle('toc', parent=base, fontSize=10.4, leading=14.5, spaceBefore=2, spaceAfter=0),
        'small': ParagraphStyle('small', parent=base, fontSize=9.2, leading=13, textColor=MUTED),
        'code': ParagraphStyle('code', parent=base, fontName='Consolas', fontSize=9, leading=12.5, backColor=PALE, borderPadding=8, spaceBefore=4, spaceAfter=12),
    }
    toc = TableOfContents()
    toc.levelStyles = [styles['toc']]
    toc.dotsMinLevel = 0
    story = [Spacer(1, 1), PageBreak(), Paragraph('Contents', styles['chapter']),
             Paragraph('Select a chapter to jump to its page. Use the PDF bookmarks to find a specific topic.', styles['small']), toc, PageBreak()]
    lines = source.read_text(encoding='utf-8').splitlines()
    # The title and subtitle belong on the branded cover, not a duplicate body page.
    i = next(n for n, line in enumerate(lines) if line.startswith('## '))
    bookmarks = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith('## ') or line.startswith('### '):
            chapter = line.startswith('## ')
            title = line[3 if chapter else 4:]
            paragraph = (Chapter if chapter else Paragraph)(inline(title), styles['chapter' if chapter else 'section'])
            bookmarks += 1
            paragraph.bookmark = f'topic-{bookmarks}'
            story.append(paragraph)
            i += 1
        elif line.startswith('```'):
            language = line[3:].strip()
            i += 1
            block = []
            while i < len(lines) and not lines[i].startswith('```'):
                block.append(lines[i])
                i += 1
            i += 1
            if language == 'mermaid':
                story.extend([Workflow('\n'.join(block), styles), Spacer(1, 12)])
            else:
                story.append(Preformatted('\n'.join(block), styles['code'], maxLineLength=92))
        elif line.startswith('|'):
            block = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                block.append(lines[i])
                i += 1
            story.append(table(block, styles))
        elif line.startswith('>'):
            block = []
            while i < len(lines) and lines[i].startswith('>'):
                block.append(lines[i].lstrip('> '))
                i += 1
            callout = Table([[Paragraph(inline(' '.join(block)), styles['body'])]], colWidths=[CONTENT], spaceAfter=12)
            callout.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), PALE), ('LINEBEFORE', (0, 0), (0, -1), 2, CYAN),
                                        ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12),
                                        ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 1)]))
            story.append(callout)
        elif match := re.match(r'^(\d+\.|-)\s+(.+)', line):
            bullet, text = match.groups()
            story.append(Paragraph(inline(text), styles['list'], bulletText='•' if bullet == '-' else bullet))
            i += 1
        else:
            block = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r'^(#|\||>|```|\d+\. |-[ ])', lines[i]):
                block.append(lines[i].strip())
                i += 1
            story.append(Paragraph(inline(' '.join(block)), styles['body']))
    output.parent.mkdir(parents=True, exist_ok=True)
    Guide(output, styles).multiBuild(story)
    print(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font-dir', type=Path, default=Path('C:/Windows/Fonts'))
    parser.add_argument('--output', type=Path, default=HERE / 'pdf/09-Quarry-Product-Guide.pdf')
    args = parser.parse_args()
    build(HERE / '09-Product-Guide.md', args.output, args.font_dir)
