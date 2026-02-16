export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export class BadRequest extends ApiError {
  constructor(message = 'Bad request') {
    super(400, message)
  }
}

export class Unauthorized extends ApiError {
  constructor(message = 'Unauthorized') {
    super(401, message)
  }
}

export class Forbidden extends ApiError {
  constructor(message = 'Forbidden') {
    super(403, message)
  }
}

export class NotFound extends ApiError {
  constructor(message = 'Not found') {
    super(404, message)
  }
}

export class RateLimited extends ApiError {
  constructor(message = 'Rate limit exceeded') {
    super(429, message)
  }
}
