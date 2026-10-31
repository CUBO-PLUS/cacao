import negocios from '@/data/negocios.json';

// The businesses for the "near me" check in the browser. The position never reaches this route: the browser
// measures the distances itself. The data changes only when the file is regenerated, so it may be cached a day.
export function GET() {
  return Response.json(negocios.lugares, {
    headers: { 'cache-control': 'public, max-age=86400' },
  });
}
