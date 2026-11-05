export { ChatHub } from './hub';

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') return new Response('ok');
    if (pathname === '/connect') return env.CHAT_HUB.getByName('hub').fetch(request);
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
