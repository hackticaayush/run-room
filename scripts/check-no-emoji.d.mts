export interface Problem {
  line: number;
  col: number;
  message: string;
}
export declare const DEFAULT_TARGETS: string[];
export declare function scanText(text: string): Problem[];
export declare function scanPackageJson(text: string): Problem[];
export declare function run(targets: string[], log?: (msg: string) => void): { failures: number; scanned: number };
