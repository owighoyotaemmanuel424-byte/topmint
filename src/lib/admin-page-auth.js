import { verifyAdminToken } from './auth';
function readCookie(header,name){if(!header)return null;const match=header.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='));return match?decodeURIComponent(match.slice(name.length+1)):null;}
export async function requireAdminPage({req}){const token=readCookie(req?.headers?.cookie,'admin_token');const id=token?await verifyAdminToken(token):null;if(!id)return {redirect:{destination:'/signin_admin',permanent:false}};return {props:{}};}
