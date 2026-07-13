/**
 * 获取登录用户信息接口
 *
 * 备注：
 * 这个接口用于后端登录成功之后调用，非客户端直接调用
 */

import { getTokenFromStore } from '~/server/utils/CookieStore';
import { getMpAccountInfo } from '~/server/utils/mp-account-info';

export default defineEventHandler(async event => {
  const token = await getTokenFromStore(event);
  if (!token) {
    return { nick_name: '', head_img: '', error: '未登录或登录已过期，请重新扫码登录' };
  }

  return getMpAccountInfo(event, token);
});
