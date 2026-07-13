import dayjs from 'dayjs';
import { cookieStore, getCookieFromResponse, getCookiesFromRequest } from '~/server/utils/CookieStore';
import { getMpAccountInfo } from '~/server/utils/mp-account-info';
import { proxyMpRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const cookie = getCookiesFromRequest(event);

  const payload: Record<string, string | number> = {
    userlang: 'zh_CN',
    redirect_url: '',
    cookie_forbidden: 0,
    cookie_cleaned: 0,
    plugin_used: 0,
    login_type: 3,
    token: '',
    lang: 'zh_CN',
    f: 'json',
    ajax: 1,
  };

  const response: Response = await proxyMpRequest({
    event: event,
    method: 'POST',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/bizlogin',
    query: {
      action: 'login',
    },
    body: payload,
    cookie: cookie,
    action: 'login', // 有这个标志就会把微信原始响应中的所有 set-cookie 存储在 CookieStore 中，并返回给客户端一个唯一的cookie: auth-key=xxx
  });

  // 从响应中取出唯一的 set-cookie (即上一步 `action=login` 标志所设置的 auth-key=xxx)
  const authKey = getCookieFromResponse('auth-key', response);
  if (!authKey) {
    return {
      err: '登录失败，请稍后重试',
    };
  }

  const token = await cookieStore.getToken(authKey);
  const mpCookie = await cookieStore.getCookie(authKey);
  if (!token || !mpCookie) {
    return {
      err: '登录态保存失败，请重新扫码登录',
    };
  }

  const { nick_name, head_img } = await getMpAccountInfo(event, token, mpCookie);
  if (!nick_name) {
    return {
      err: '获取公众号昵称失败，请稍后重试',
    };
  }

  const body = JSON.stringify({
    nickname: nick_name,
    avatar: head_img,
    expires: dayjs().add(4, 'days').toString(),
  });
  const headers = new Headers(response.headers);
  headers.set('Content-Length', new TextEncoder().encode(body).length.toString());
  return new Response(body, { headers: headers });
});
