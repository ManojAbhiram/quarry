import csv
import io
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

# ── CSV Generation ────────────────────────────────────────────────────────────

def generate_csv(headers, rows) -> bytes:
    output = io.StringIO()
    # Write BOM for Excel UTF-8 compatibility
    output.write('\ufeff')
    writer = csv.writer(output)
    writer.writerow(headers)
    for row in rows:
        formatted_row = []
        for val in row:
            if isinstance(val, (list, tuple)):
                formatted_row.append("; ".join(map(str, val)))
            else:
                formatted_row.append(val if val is not None else "")
        writer.writerow(formatted_row)
    return output.getvalue().encode('utf-8-sig')


# ── XLSX Generation ───────────────────────────────────────────────────────────

def generate_xlsx(sheet_name, headers, rows) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name
    
    ws.views.sheetView[0].showGridLines = True
    

    header_fill = PatternFill(start_color="4F46E5", end_color="4F46E5", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    
    data_font = Font(name="Calibri", size=11, bold=False, color="000000")
    data_alignment = Alignment(horizontal="left", vertical="center")
    
    thin_border = Border(
        left=Side(style='thin', color='E2E8F0'),
        right=Side(style='thin', color='E2E8F0'),
        top=Side(style='thin', color='E2E8F0'),
        bottom=Side(style='thin', color='E2E8F0')
    )
    

    for col_idx, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_alignment
        cell.border = thin_border
    

    for row_idx, row in enumerate(rows, 2):
        for col_idx, val in enumerate(row, 1):
            if isinstance(val, (list, tuple)):
                val_str = "; ".join(map(str, val))
            elif isinstance(val, dict):
                val_str = str(val)
            else:
                val_str = val if val is not None else ""
                
            cell = ws.cell(row=row_idx, column=col_idx, value=val_str)
            cell.font = data_font
            cell.alignment = data_alignment
            cell.border = thin_border
            

    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        
        for cell in col:
            val = cell.value
            if val:
                val_str = str(val)
                lines = val_str.split("\n")
                for line in lines:
                    if len(line) > max_len:
                        max_len = len(line)
                        
        width = max(max_len + 3, 10)
        ws.column_dimensions[col_letter].width = min(width, 50)
        

    ws.row_dimensions[1].height = 28
    for r in range(2, len(rows) + 2):
        ws.row_dimensions[r].height = 20
        
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


# ── PDF Report Card Generation (ReportLab) ────────────────────────────────────

def generate_companies_pdf(leads) -> bytes:
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )
    
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#4F46E5'),
        spaceAfter=8
    )
    
    meta_style = ParagraphStyle(
        'DocMeta',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=9,
        leading=11,
        textColor=colors.HexColor('#64748B'),
        spaceAfter=15
    )
    
    company_title_style = ParagraphStyle(
        'CompanyTitle',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=15,
        textColor=colors.HexColor('#1E293B')
    )
    
    label_style = ParagraphStyle(
        'CardLabel',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=10,
        textColor=colors.HexColor('#475569')
    )
    
    value_style = ParagraphStyle(
        'CardValue',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=10,
        textColor=colors.HexColor('#0F172A')
    )

    desc_style = ParagraphStyle(
        'CardDesc',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor('#334155'),
        spaceBefore=3
    )

    story = []
    
    # Document Header
    story.append(Paragraph("Quarry Intelligence Report: Companies Sourced", title_style))
    story.append(Paragraph(f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | Sourced Companies: {len(leads)}", meta_style))
    story.append(Spacer(1, 5))
    
    for idx, lead in enumerate(leads):
        elements_in_card = []
        
        name = lead.get("company_name") or lead.get("name") or lead.get("title") or "Unknown Company"
        score = lead.get("match_score") or "--"
        intent_score = lead.get("intent_score") or "--"
        intent_band = lead.get("intent_band") or "--"
        

        header_text = f"<b>{idx+1}. {name}</b>"
        if lead.get("url") and lead.get("url") != "null":
            header_text += f" &nbsp;&nbsp;&nbsp;&nbsp;<font color='#4F46E5'><u>{lead.get('url')}</u></font>"
            
        elements_in_card.append(Paragraph(header_text, company_title_style))
        elements_in_card.append(Spacer(1, 4))
        

        match_info_text = f"<b>ICP Match Score:</b> {score} &nbsp;|&nbsp; <b>Intent Score:</b> {intent_score} ({intent_band})"
        elements_in_card.append(Paragraph(match_info_text, ParagraphStyle('MatchInfo', parent=styles['Normal'], fontSize=9, leading=11, textColor=colors.HexColor('#4F46E5'))))
        elements_in_card.append(Spacer(1, 4))
        

        grid_data = [
            [
                Paragraph("<b>Industry:</b>", label_style), Paragraph(lead.get("industry") or "--", value_style),
                Paragraph("<b>Employees:</b>", label_style), Paragraph(str(lead.get("employee_size_estimate") or "--"), value_style)
            ],
            [
                Paragraph("<b>Growth:</b>", label_style), Paragraph(str(lead.get("growth") or "--"), value_style),
                Paragraph("<b>Funding Stage:</b>", label_style), Paragraph(lead.get("funding_stage") or "--", value_style)
            ],
            [
                Paragraph("<b>Location:</b>", label_style), Paragraph(lead.get("location") or "--", value_style),
                Paragraph("<b>Tech Stack:</b>", label_style), Paragraph(", ".join(lead.get("tech_stack") or []) or "--", value_style)
            ]
        ]
        
        grid_table = Table(grid_data, colWidths=[65, 195, 85, 195])
        grid_table.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2),
            ('TOPPADDING', (0,0), (-1,-1), 2),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ]))
        elements_in_card.append(grid_table)
        elements_in_card.append(Spacer(1, 4))
        

        signals_text = ", ".join(lead.get("signals") or []) or "--"
        elements_in_card.append(Paragraph(f"<b>Scraped Signals:</b> {signals_text}", value_style))
        

        intent_sigs = lead.get("intent_signals") or []
        if intent_sigs:
            elements_in_card.append(Spacer(1, 3))
            intent_sig_items = []
            for sig in intent_sigs:
                sig_type = sig.get('type') or 'Signal'
                sig_summary = sig.get('summary') or ''
                intent_sig_items.append(f"• <b>{sig_type}:</b> {sig_summary}")
            intent_sigs_text = "<br/>".join(intent_sig_items)
            elements_in_card.append(Paragraph(f"<b>Deep Intent Signals:</b><br/>{intent_sigs_text}", value_style))
        

        desc = lead.get("description") or ""
        if desc:
            elements_in_card.append(Spacer(1, 4))
            elements_in_card.append(Paragraph(f"<b>Description:</b> {desc}", desc_style))
            

        card_table = Table([[elements_in_card]], colWidths=[540])
        card_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
            ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
            ('TOPPADDING', (0,0), (-1,-1), 8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
            ('RIGHTPADDING', (0,0), (-1,-1), 10),
        ]))
        
        story.append(KeepTogether([card_table, Spacer(1, 10)]))
        
    doc.build(story)
    return buffer.getvalue()


def generate_competitors_pdf(competitors) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )
    
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#4F46E5'),
        spaceAfter=8
    )
    
    meta_style = ParagraphStyle(
        'DocMeta',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=9,
        leading=11,
        textColor=colors.HexColor('#64748B'),
        spaceAfter=15
    )
    
    comp_title_style = ParagraphStyle(
        'CompTitle',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=15,
        textColor=colors.HexColor('#1E293B')
    )
    
    label_style = ParagraphStyle(
        'CardLabel',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=10,
        textColor=colors.HexColor('#475569')
    )
    
    value_style = ParagraphStyle(
        'CardValue',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=10,
        textColor=colors.HexColor('#0F172A')
    )

    desc_style = ParagraphStyle(
        'CardDesc',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor('#334155'),
        spaceBefore=3
    )

    story = []
    
    story.append(Paragraph("Quarry Intelligence Report: Competitor Intelligence", title_style))
    story.append(Paragraph(f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | Competitors Tracked: {len(competitors)}", meta_style))
    story.append(Spacer(1, 5))
    
    for idx, comp in enumerate(competitors):
        elements_in_card = []
        
        name = comp.get("name") or "--"
        website = comp.get("website") or ""
        

        header_text = f"<b>{idx+1}. {name}</b>"
        if website and website != '--':
            header_text += f" &nbsp;&nbsp;&nbsp;&nbsp;<font color='#4F46E5'><u>{website}</u></font>"
            
        elements_in_card.append(Paragraph(header_text, comp_title_style))
        elements_in_card.append(Spacer(1, 4))
        

        tier = comp.get("tier") or "--"
        overlap = comp.get("overlap_score") or "--"
        g2 = comp.get("g2_rating") or "--"
        
        match_info_text = f"<b>Tier Segment:</b> {tier} &nbsp;|&nbsp; <b>Overlap Score:</b> {overlap}% &nbsp;|&nbsp; <b>G2 Rating:</b> {g2}"
        elements_in_card.append(Paragraph(match_info_text, ParagraphStyle('MatchInfo', parent=styles['Normal'], fontSize=9, leading=11, textColor=colors.HexColor('#4F46E5'))))
        elements_in_card.append(Spacer(1, 4))
        

        grid_data = [
            [
                Paragraph("<b>Category:</b>", label_style), Paragraph(comp.get("category") or "--", value_style),
                Paragraph("<b>Employee Count:</b>", label_style), Paragraph(str(comp.get("employee_count") or comp.get("size") or "--"), value_style)
            ],
            [
                Paragraph("<b>Location:</b>", label_style), Paragraph(comp.get("headquarters") or comp.get("location") or "--", value_style),
                Paragraph("<b>Funding:</b>", label_style), Paragraph(comp.get("funding") or "--", value_style)
            ],
            [
                Paragraph("<b>Specialties:</b>", label_style), Paragraph(comp.get("specialties") or "--", value_style),
                Paragraph("", label_style), Paragraph("", value_style)
            ]
        ]
        
        grid_table = Table(grid_data, colWidths=[65, 195, 95, 185])
        grid_table.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2),
            ('TOPPADDING', (0,0), (-1,-1), 2),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ]))
        elements_in_card.append(grid_table)
        elements_in_card.append(Spacer(1, 4))
        

        desc = comp.get("description") or ""
        if desc and desc != '--':
            elements_in_card.append(Paragraph(f"<b>Description:</b> {desc}", desc_style))
            

        reason = comp.get("reason") or ""
        if reason:
            elements_in_card.append(Spacer(1, 3))
            elements_in_card.append(Paragraph(f"<b>Overlap Context:</b> {reason}", desc_style))
            

        card_table = Table([[elements_in_card]], colWidths=[540])
        card_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
            ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
            ('TOPPADDING', (0,0), (-1,-1), 8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
            ('RIGHTPADDING', (0,0), (-1,-1), 10),
        ]))
        
        story.append(KeepTogether([card_table, Spacer(1, 10)]))
        
    doc.build(story)
    return buffer.getvalue()


def generate_decision_makers_pdf(contacts) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )
    
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#4F46E5'),
        spaceAfter=8
    )
    
    meta_style = ParagraphStyle(
        'DocMeta',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=9,
        leading=11,
        textColor=colors.HexColor('#64748B'),
        spaceAfter=15
    )
    
    dm_title_style = ParagraphStyle(
        'DmTitle',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=15,
        textColor=colors.HexColor('#1E293B')
    )
    
    label_style = ParagraphStyle(
        'CardLabel',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=10,
        textColor=colors.HexColor('#475569')
    )
    
    value_style = ParagraphStyle(
        'CardValue',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=10,
        textColor=colors.HexColor('#0F172A')
    )

    desc_style = ParagraphStyle(
        'CardDesc',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor('#334155'),
        spaceBefore=3
    )

    story = []
    
    story.append(Paragraph("Quarry Intelligence Report: Decision Makers", title_style))
    story.append(Paragraph(f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | Decision Makers Sourced: {len(contacts)}", meta_style))
    story.append(Spacer(1, 5))
    
    for idx, dm in enumerate(contacts):
        elements_in_card = []
        
        name = dm.get("name") or "Unknown Contact"
        title = dm.get("title") or "Decision Maker"
        company = dm.get("company") or dm.get("company_name") or "Unknown Company"
        

        header_text = f"<b>{idx+1}. {name}</b> - <font size=10.5>{title}</font>"
        elements_in_card.append(Paragraph(header_text, dm_title_style))
        elements_in_card.append(Spacer(1, 3))
        
        company_text = f"<b>Company:</b> {company}"
        elements_in_card.append(Paragraph(company_text, ParagraphStyle('DmCompany', parent=styles['Normal'], fontSize=9.5, leading=11, textColor=colors.HexColor('#4F46E5'))))
        elements_in_card.append(Spacer(1, 4))
        

        linkedin = dm.get("linkedin_url") or dm.get("url") or ""
        linkedin_link = f"<font color='#4F46E5'><u>{linkedin}</u></font>" if linkedin else "--"
        
        grid_data = [
            [
                Paragraph("<b>Department:</b>", label_style), Paragraph(dm.get("department") or "--", value_style),
                Paragraph("<b>Seniority:</b>", label_style), Paragraph(dm.get("seniority") or "--", value_style)
            ],
            [
                Paragraph("<b>Location:</b>", label_style), Paragraph(dm.get("location") or "--", value_style),
                Paragraph("<b>LinkedIn:</b>", label_style), Paragraph(linkedin_link, value_style)
            ]
        ]
        
        grid_table = Table(grid_data, colWidths=[70, 190, 70, 210])
        grid_table.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2),
            ('TOPPADDING', (0,0), (-1,-1), 2),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ]))
        elements_in_card.append(grid_table)
        elements_in_card.append(Spacer(1, 4))
        

        snippet = dm.get("snippet") or ""
        if snippet:
            elements_in_card.append(Paragraph(f"<b>Context Snippet:</b> {snippet}", desc_style))
            

        card_table = Table([[elements_in_card]], colWidths=[540])
        card_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
            ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
            ('TOPPADDING', (0,0), (-1,-1), 8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
            ('RIGHTPADDING', (0,0), (-1,-1), 10),
        ]))
        
        story.append(KeepTogether([card_table, Spacer(1, 10)]))
        
    doc.build(story)
    return buffer.getvalue()
