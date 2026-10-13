import { Request, Response, NextFunction } from 'express';

// Recursive string sanitizer to strip script tags, dangerous URI protocols, and event handlers
function cleanString(input: string): string {
  if (typeof input !== 'string') return input;

  return input
    // Remove null bytes
    .replace(/\0/g, '')
    // Strip <script> tags and content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Strip javascript: pseudo-protocol
    .replace(/javascript:[^"']*/gi, '')
    // Strip dangerous HTML tags
    .replace(/<\s*(iframe|object|embed|applet|meta|link|base)[^>]*>/gi, '')
    // Strip inline event handlers like onerror=, onload=, onclick=
    .replace(/\bon\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
    .trim();
}

function sanitizeObject(obj: any, depth = 0): any {
  if (depth > 10 || obj === null || typeof obj !== 'object') {
    return typeof obj === 'string' ? cleanString(obj) : obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1));
  }

  const cleaned: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    // Defend against prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    cleaned[key] = sanitizeObject(obj[key], depth + 1);
  }
  return cleaned;
}

export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeObject(req.params);
  }
  next();
};
