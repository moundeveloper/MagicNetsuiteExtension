type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "**";

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  ceil: Math.ceil,
  cos: Math.cos,
  exp: Math.exp,
  floor: Math.floor,
  ln: Math.log,
  log: Math.log10,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan
};

const CONSTANTS: Record<string, number> = {
  e: Math.E,
  pi: Math.PI
};

class MathExpressionParser {
  private position = 0;

  constructor(private readonly source: string) {}

  parse(): number {
    if (this.source.length > 500) {
      throw new Error("Expression is too long.");
    }
    const value = this.parseAdditive();
    this.skipWhitespace();
    if (this.position !== this.source.length) {
      throw new Error(`Unexpected token at position ${this.position + 1}.`);
    }
    if (!Number.isFinite(value)) {
      throw new Error("Result is not a finite number.");
    }
    return value;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (true) {
      if (this.consume("+")) value += this.parseMultiplicative();
      else if (this.consume("-")) value -= this.parseMultiplicative();
      else return value;
    }
  }

  private parseMultiplicative(): number {
    let value = this.parsePower();
    while (true) {
      if (this.consume("*", "**")) value = this.apply("*", value, this.parsePower());
      else if (this.consume("/")) value = this.apply("/", value, this.parsePower());
      else if (this.consume("%")) value = this.apply("%", value, this.parsePower());
      else return value;
    }
  }

  private parsePower(): number {
    const left = this.parseUnary();
    return this.consume("**")
      ? this.apply("**", left, this.parsePower())
      : left;
  }

  private parseUnary(): number {
    if (this.consume("+")) return this.parseUnary();
    if (this.consume("-")) return -this.parseUnary();
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    if (this.consume("(")) {
      const value = this.parseAdditive();
      if (!this.consume(")")) throw new Error("Missing closing parenthesis.");
      return value;
    }

    const number = this.readNumber();
    if (number !== null) return number;

    const identifier = this.readIdentifier();
    if (!identifier) {
      throw new Error(`Expected a number at position ${this.position + 1}.`);
    }

    const normalized = identifier.toLowerCase();
    if (normalized in CONSTANTS) return CONSTANTS[normalized]!;

    const fn = FUNCTIONS[normalized];
    if (!fn || !this.consume("(")) {
      throw new Error(`Unsupported function or constant: ${identifier}.`);
    }

    const args: number[] = [];
    if (!this.consume(")")) {
      do {
        args.push(this.parseAdditive());
      } while (this.consume(","));
      if (!this.consume(")")) throw new Error("Missing closing parenthesis.");
    }

    const result = fn(...args);
    if (!Number.isFinite(result)) throw new Error("Function returned an invalid result.");
    return result;
  }

  private readNumber(): number | null {
    this.skipWhitespace();
    const match = this.source
      .slice(this.position)
      .match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (!match) return null;
    this.position += match[0].length;
    return Number(match[0]);
  }

  private readIdentifier(): string | null {
    this.skipWhitespace();
    const match = this.source.slice(this.position).match(/^[A-Za-z]+/);
    if (!match) return null;
    this.position += match[0].length;
    return match[0];
  }

  private consume(token: string, excludedPrefix?: string): boolean {
    this.skipWhitespace();
    if (
      (excludedPrefix && this.source.startsWith(excludedPrefix, this.position)) ||
      !this.source.startsWith(token, this.position)
    ) {
      return false;
    }
    this.position += token.length;
    return true;
  }

  private apply(operator: BinaryOperator, left: number, right: number): number {
    switch (operator) {
      case "*":
        return left * right;
      case "/":
        if (right === 0) throw new Error("Division by zero.");
        return left / right;
      case "%":
        if (right === 0) throw new Error("Division by zero.");
        return left % right;
      case "**":
        return left ** right;
      default:
        return operator === "+" ? left + right : left - right;
    }
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.position] ?? "")) this.position += 1;
  }
}

export const evaluateMathExpression = (expression: string): number =>
  new MathExpressionParser(expression).parse();
