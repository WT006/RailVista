/**
 * 纪念票可扫描码：真实 QR（uqr）+ Code128-B 条形码（无人类可读网址）。
 * 条码仅画条空，票面另用 serial 作编号，避免微信/扫码器把 URL 当商品码旁注。
 */

import { encode } from 'uqr';

/** 出厂默认扫码目标（与 packages/shared createTicketConfig 保持一致） */
export const WAYBOOK_URL = 'https://waybook.tyuho.cn';

/** 票面页脚固定文案（不可在高级编辑中改） */
export const TICKET_QR_CAPTION = 'SCAN · 路书';
export const TICKET_FOOTER_BRAND = '万里路书 HEY WORLD';

/** Code128 符号表 0–105（含 Start A/B/C）；Stop 另附终结条 */
const CODE128_PATTERNS = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
  '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
  '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
  '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
  '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
  '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
  '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
  '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
  '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
  '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
  '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
  '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010000100', '11010010000',
  '11010011100',
] as const;

const CODE128_STOP = '1100011101011'; // Stop + 终结 2-module bar
const START_B = 104;

export interface QrMatrix {
  size: number;
  /** row-major，true = 黑模块 */
  modules: boolean[][];
}

/** 生成带 quiet zone 的 QR 矩阵（可扫） */
export function buildQrMatrix(value: string): QrMatrix {
  const text = (value || WAYBOOK_URL).trim() || WAYBOOK_URL;
  const { size, data } = encode(text, { ecc: 'M', border: 1 });
  return { size, modules: data };
}

export interface BarcodeLayout {
  /** 总模块宽（viewBox 宽度） */
  width: number;
  /** 交替条宽列表，奇数索引为墨条（从 0 起为墨） */
  bars: number[];
}

/**
 * Code128-B：仅返回条宽序列（无下方 URL 文字）。
 * 非 ASCII / 空串时回退 WAYBOOK_URL。
 */
export function buildCode128Bars(value: string): BarcodeLayout {
  let text = (value || WAYBOOK_URL).trim() || WAYBOOK_URL;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 32 || c > 127) {
      text = WAYBOOK_URL;
      break;
    }
  }

  const codes: number[] = [START_B];
  for (let i = 0; i < text.length; i++) {
    codes.push(text.charCodeAt(i) - 32);
  }
  let checksum = START_B;
  for (let i = 1; i < codes.length; i++) {
    checksum += codes[i]! * i;
  }
  codes.push(checksum % 103);

  const bits = codes.map((c) => CODE128_PATTERNS[c]!).join('') + CODE128_STOP;
  const bars: number[] = [];
  let run = 1;
  for (let i = 1; i < bits.length; i++) {
    if (bits[i] === bits[i - 1]) run++;
    else {
      bars.push(run);
      run = 1;
    }
  }
  bars.push(run);

  const width = bars.reduce((a, b) => a + b, 0);
  return { width, bars };
}
