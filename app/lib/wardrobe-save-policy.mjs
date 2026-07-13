export function shouldKeepWardrobeValidationOpen(status) {
  return status >= 400 && status < 500 && ![408, 409, 410, 425, 429].includes(status);
}

export function wardrobeValidationMessage(status) {
  if (status === 401 || status === 403)
    return "登录状态已经变化，请重新打开页面后再保存。";
  if (status === 413) return "照片太大，请选择小于 6 MB 的图片。";
  if (status === 415) return "照片格式不支持，请使用 JPEG、PNG 或 WebP。";
  return "衣物资料有一项无法保存，请检查名称、商品链接和尺寸。";
}
