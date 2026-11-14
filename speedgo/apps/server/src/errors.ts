export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export const badRequest = (m: string, code?: string) => new HttpError(400, m, code);
export const unauthorized = (m = 'Please sign in again', code = 'UNAUTHORIZED') => new HttpError(401, m, code);
export const forbidden = (m = 'You do not have permission to do this', code = 'FORBIDDEN') => new HttpError(403, m, code);
export const notFound = (m = 'Not found') => new HttpError(404, m, 'NOT_FOUND');
export const conflict = (m: string, code?: string) => new HttpError(409, m, code);
export const unprocessable = (m: string, code?: string) => new HttpError(422, m, code);
