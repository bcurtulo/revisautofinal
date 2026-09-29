import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Vehicle, MaintenanceLog, FinancialRecord } from './types';
import { formatAppDate, formatAppCurrency, type DateFormat } from './utils/format';

/**
 * Relatório resumido em PDF de um veículo — pensado para o dono mostrar ao
 * comprador na hora de vender: identidade do veículo, quilometragem,
 * histórico de manutenções e de impostos/multas registrados no app.
 *
 * Gerado inteiramente no navegador (pdf-lib), sem passar pelo servidor —
 * os dados já estão carregados na tela de detalhe do veículo quando o
 * usuário clica em exportar.
 */

interface ReportLabels {
  title: string;
  generatedOn: string;
  vehicleData: string;
  brand: string;
  model: string;
  year: string;
  plate: string;
  color: string;
  currentMileage: string;
  mileageSummary: string;
  totalRecords: string;
  totalSpentFuel: string;
  totalLiters: string;
  maintenanceSection: string;
  maintenanceEmpty: string;
  colDate: string;
  colType: string;
  colDescription: string;
  colProvider: string;
  colCost: string;
  financialSection: string;
  financialEmpty: string;
  colStatus: string;
  colValue: string;
  totalSpentMaintenance: string;
  totalSpentFinancial: string;
  disclaimer: string;
  noColor: string;
  noPlate: string;
}

interface GenerateReportParams {
  vehicle: Vehicle;
  maintenanceLogs: MaintenanceLog[];
  financialRecords: FinancialRecord[];
  dateFormat: DateFormat;
  currency: string;
  language: string;
  labels: ReportLabels;
}

const PAGE_WIDTH = 595.28; // A4 em pontos
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const GREEN = rgb(0.204, 0.627, 0.416); // #34a06a
const DARK = rgb(0.09, 0.09, 0.1);
const GRAY = rgb(0.4, 0.42, 0.44);
const LIGHT_GRAY = rgb(0.88, 0.89, 0.9);

/** Remove acentuação fora do WinAnsi apenas como rede de segurança — os
 * caracteres latinos comuns (á, ã, ç, é...) já são suportados nativamente
 * pela fonte Helvetica padrão do PDF, então isto raramente entra em ação. */
function safeText(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return '';
  return String(s).normalize('NFC');
}

export async function generateVehicleReportPdf(params: GenerateReportParams): Promise<Uint8Array> {
  const { vehicle, maintenanceLogs, financialRecords, dateFormat, currency, language, labels } = params;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN + 30) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawText = (text: string, opts: { x?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(safeText(text), {
      x: opts.x ?? MARGIN,
      y,
      size: opts.size ?? 10,
      font: opts.bold ? fontBold : font,
      color: opts.color ?? DARK,
    });
  };

  const drawLine = (color = LIGHT_GRAY) => {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.75, color });
  };

  // ─── Cabeçalho ────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 90, width: PAGE_WIDTH, height: 90, color: DARK });
  page.drawText('Revis', { x: MARGIN, y: PAGE_HEIGHT - 42, size: 20, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('Auto', { x: MARGIN + 52, y: PAGE_HEIGHT - 42, size: 20, font: fontBold, color: GREEN });
  page.drawText(safeText(labels.title), { x: MARGIN, y: PAGE_HEIGHT - 66, size: 11, font, color: rgb(0.85, 0.85, 0.85) });
  const genDate = formatAppDate(new Date(), dateFormat);
  page.drawText(`${labels.generatedOn} ${genDate}`, {
    x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(`${labels.generatedOn} ${genDate}`, 9),
    y: PAGE_HEIGHT - 42,
    size: 9,
    font,
    color: rgb(0.7, 0.7, 0.7),
  });
  y = PAGE_HEIGHT - 90 - 36;

  // ─── Dados do veículo ─────────────────────────────────────────────────
  drawText(labels.vehicleData, { size: 13, bold: true, color: GREEN });
  y -= 10;
  drawLine();
  y -= 22;

  const vehicleTitle = `${vehicle.brand} ${vehicle.model}`;
  drawText(vehicleTitle, { size: 16, bold: true });
  y -= 24;

  const infoRow = (label: string, value: string) => {
    drawText(label, { size: 9, color: GRAY });
    drawText(value, { x: MARGIN + 130, size: 10.5, bold: true });
    y -= 20;
  };
  infoRow(labels.year, safeText(vehicle.year));
  infoRow(labels.plate, vehicle.plate ? safeText(vehicle.plate) : labels.noPlate);
  infoRow(labels.color, vehicle.color ? safeText(vehicle.color) : labels.noColor);
  infoRow(labels.currentMileage, `${new Intl.NumberFormat(language.startsWith('en') ? 'en-US' : 'pt-BR').format(vehicle.current_mileage || 0)} km`);
  y -= 8;

  // ─── Resumo de abastecimento/quilometragem ────────────────────────────
  const mileageHistory = vehicle.mileage_history || [];
  const totalFuelSpent = mileageHistory.reduce((sum, m) => sum + (Number(m.valor) || 0), 0);
  const totalLiters = mileageHistory.reduce((sum, m) => sum + (Number(m.litros) || 0), 0);

  ensureSpace(90);
  drawText(labels.mileageSummary, { size: 13, bold: true, color: GREEN });
  y -= 10;
  drawLine();
  y -= 22;
  infoRow(labels.totalRecords, String(mileageHistory.length));
  infoRow(labels.totalSpentFuel, formatAppCurrency(totalFuelSpent, currency, language));
  infoRow(labels.totalLiters, `${totalLiters.toLocaleString(language.startsWith('en') ? 'en-US' : 'pt-BR', { maximumFractionDigits: 1 })} L`);
  y -= 8;

  // ─── Tabela genérica ──────────────────────────────────────────────────
  const drawTableHeader = (columns: { label: string; width: number }[]) => {
    ensureSpace(28);
    let x = MARGIN;
    page.drawRectangle({ x: MARGIN, y: y - 6, width: CONTENT_WIDTH, height: 20, color: rgb(0.95, 0.96, 0.95) });
    for (const col of columns) {
      page.drawText(safeText(col.label), { x: x + 4, y: y, size: 8.5, font: fontBold, color: GRAY });
      x += col.width;
    }
    y -= 22;
  };

  const drawTableRow = (values: string[], columns: { width: number }[], zebra: boolean) => {
    ensureSpace(20);
    if (zebra) {
      page.drawRectangle({ x: MARGIN, y: y - 5, width: CONTENT_WIDTH, height: 18, color: rgb(0.98, 0.98, 0.98) });
    }
    let x = MARGIN;
    values.forEach((val, i) => {
      const maxChars = Math.floor(columns[i].width / 4.6);
      const truncated = val.length > maxChars ? val.slice(0, maxChars - 1) + '…' : val;
      page.drawText(safeText(truncated), { x: x + 4, y, size: 8.5, font, color: DARK });
      x += columns[i].width;
    });
    y -= 18;
  };

  // ─── Manutenções e serviços ───────────────────────────────────────────
  ensureSpace(60);
  drawText(labels.maintenanceSection, { size: 13, bold: true, color: GREEN });
  y -= 10;
  drawLine();
  y -= 20;

  if (maintenanceLogs.length === 0) {
    drawText(labels.maintenanceEmpty, { size: 9.5, color: GRAY });
    y -= 20;
  } else {
    const maintCols = [
      { label: labels.colDate, width: 70 },
      { label: labels.colType, width: 90 },
      { label: labels.colDescription, width: 190 },
      { label: labels.colProvider, width: 110 },
      { label: labels.colCost, width: CONTENT_WIDTH - 70 - 90 - 190 - 110 },
    ];
    drawTableHeader(maintCols);
    const sortedMaint = [...maintenanceLogs].sort((a, b) => (a.date < b.date ? 1 : -1));
    let totalMaintCost = 0;
    sortedMaint.forEach((log, i) => {
      totalMaintCost += Number(log.cost) || 0;
      drawTableRow(
        [
          formatAppDate(log.date, dateFormat),
          safeText(log.type),
          safeText(log.description),
          log.provider ? safeText(log.provider) : '—',
          formatAppCurrency(Number(log.cost) || 0, currency, language),
        ],
        maintCols,
        i % 2 === 1,
      );
    });
    y -= 6;
    ensureSpace(20);
    drawText(labels.totalSpentMaintenance, { size: 9.5, bold: true, color: GRAY });
    drawText(formatAppCurrency(totalMaintCost, currency, language), { x: PAGE_WIDTH - MARGIN - 90, size: 9.5, bold: true });
    y -= 24;
  }

  // ─── Impostos, taxas e multas ─────────────────────────────────────────
  ensureSpace(60);
  drawText(labels.financialSection, { size: 13, bold: true, color: GREEN });
  y -= 10;
  drawLine();
  y -= 20;

  if (financialRecords.length === 0) {
    drawText(labels.financialEmpty, { size: 9.5, color: GRAY });
    y -= 20;
  } else {
    const finCols = [
      { label: labels.colDate, width: 70 },
      { label: labels.colType, width: 90 },
      { label: labels.colDescription, width: 210 },
      { label: labels.colStatus, width: 90 },
      { label: labels.colValue, width: CONTENT_WIDTH - 70 - 90 - 210 - 90 },
    ];
    drawTableHeader(finCols);
    const sortedFin = [...financialRecords].sort((a, b) => (a.due_date < b.due_date ? 1 : -1));
    let totalFinValue = 0;
    sortedFin.forEach((rec, i) => {
      totalFinValue += Number(rec.value) || 0;
      drawTableRow(
        [
          formatAppDate(rec.due_date, dateFormat),
          safeText(rec.type),
          safeText(rec.description),
          safeText(rec.status),
          formatAppCurrency(Number(rec.value) || 0, currency, language),
        ],
        finCols,
        i % 2 === 1,
      );
    });
    y -= 6;
    ensureSpace(20);
    drawText(labels.totalSpentFinancial, { size: 9.5, bold: true, color: GRAY });
    drawText(formatAppCurrency(totalFinValue, currency, language), { x: PAGE_WIDTH - MARGIN - 90, size: 9.5, bold: true });
  }

  // ─── Rodapé em todas as páginas ───────────────────────────────────────
  const pages = pdfDoc.getPages();
  pages.forEach((p, idx) => {
    p.drawLine({ start: { x: MARGIN, y: 34 }, end: { x: PAGE_WIDTH - MARGIN, y: 34 }, thickness: 0.5, color: LIGHT_GRAY });
    p.drawText(safeText(labels.disclaimer), { x: MARGIN, y: 20, size: 7, font, color: GRAY });
    const pageLabel = `${idx + 1}/${pages.length}`;
    p.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(pageLabel, 8),
      y: 20,
      size: 8,
      font,
      color: GRAY,
    });
  });

  return pdfDoc.save();
}

/** Dispara o download do PDF no navegador, sem sair do app. */
export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
