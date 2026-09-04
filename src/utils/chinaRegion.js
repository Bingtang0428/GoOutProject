// ============================================================
// 中国省/市 行政区数据(基于 china-area-data,内置打包)
// 结构:86 → {省code: 省名}; 省code → {市code: 市名}
// ============================================================
import pca from 'china-area-data/data.json'

const root = pca['86'] || pca

/** 省级列表 [{code,name}] */
export function listProvinces() {
  return Object.entries(root).map(([code, name]) => ({ code, name }))
}

/** 某省下城市列表(直辖市直接回显自身) */
export function listCities(provinceCode) {
  const child = pca[provinceCode]
  if (!child) {
    // 直辖市等无子级的省级:把自身当作唯一城市
    const name = root[provinceCode]
    return name ? [{ code: provinceCode, name }] : []
  }
  return Object.entries(child).map(([code, name]) => ({ code, name }))
}

/** 城市名 → 所属省(code),找不到返回 null */
export function provinceOfCity(cityName) {
  if (!cityName) return null
  for (const [pCode, pName] of Object.entries(root)) {
    const child = pca[pCode]
    if (!child) continue
    const hit = Object.values(child).find((n) => n === cityName || cityName.startsWith(n))
    if (hit) return { code: pCode, name: pName }
    // 省名直属(直辖市 = 城市本身,如“北京市”)
    if (cityName === pName) return { code: pCode, name: pName }
  }
  return null
}

/** 规范化城市名:去掉“市/地区/自治州”冗余后缀用于宽松匹配 */
export function slimCity(name) {
  return (name || '').replace(/(市|地区|自治州|盟)$/, '')
}
