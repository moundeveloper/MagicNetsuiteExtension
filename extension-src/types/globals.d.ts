/**
 * Runtime globals supplied by Chrome, NetSuite, or another extension script.
 *
 * These are deliberately broad migration boundaries. Individual message and
 * page API contracts can be narrowed without changing the emitted JavaScript.
 */
declare const chrome: any;
declare const require: any;
declare const log: any;
declare function getNetsiteParams(): any;

interface Window {
  [key: string]: any;
}
