// @author Codex
// @date 2026-07-13 16:28:04
// @comment 获取微信公众号后台登录账号基础信息

import type { H3Event } from 'h3';
import { proxyMpRequest } from '~/server/utils/proxy-request';

export interface MpAccountInfo {
  nick_name: string;
  head_img: string;
}

export async function getMpAccountInfo(event: H3Event, token: string, cookie?: string): Promise<MpAccountInfo> {
  const html: string = await proxyMpRequest({
    event: event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/home',
    query: {
      t: 'home/index',
      token: token,
      lang: 'zh_CN',
    },
    cookie: cookie,
  }).then(resp => resp.text());

  let nick_name = '';
  const nicknameMatchResult = html.match(/wx\.cgiData\.nick_name\s*?=\s*?"(?<nick_name>[^"]+)"/);
  if (nicknameMatchResult && nicknameMatchResult.groups && nicknameMatchResult.groups.nick_name) {
    nick_name = nicknameMatchResult.groups.nick_name;
  }

  let head_img = '';
  const headImgMatchResult = html.match(/wx\.cgiData\.head_img\s*?=\s*?"(?<head_img>[^"]+)"/);
  if (headImgMatchResult && headImgMatchResult.groups && headImgMatchResult.groups.head_img) {
    head_img = headImgMatchResult.groups.head_img;
  }

  return {
    nick_name: nick_name,
    head_img: head_img,
  };
}
