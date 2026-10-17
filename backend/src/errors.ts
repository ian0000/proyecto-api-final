export class Problem extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
