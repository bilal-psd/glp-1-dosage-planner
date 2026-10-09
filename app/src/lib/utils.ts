export { cn } from "cn"
// "2.50" → "2.5", "3.00" → "3".
export const mgFmt = (v: number) => (+v).toFixed(2).replace(/\.?0+$/, "")
