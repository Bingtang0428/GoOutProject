// ============================================================
// 演示数据生成(仅本地演示模式首次运行时写入)
// 日期基于「今天」动态偏移,保证提醒的「今天/明天」分组始终可见。
// 结构契约见各 store:
//   plan:   { owner_id, members[参与者], viewers[围观者], ... }
//   bills:  { name, amount, category, paid_by:{id,name}, involves:[{id,name}], link? }
//   comments:{ text, day_date, dest_id, status: open|accepted|done }
// ============================================================
import { isoPlus } from './date'

const OWNER = { id: 'u-demo-owner', name: '阿澈' }

export function buildDemoBundle() {
  const d1 = isoPlus(15)
  const d2 = isoPlus(18)

  const plans = [
    {
      id: 'demo-plan-hui',
      name: '环皖南 · 徽州秋色自驾',
      destination: '安徽 · 黄山 / 宏村',
      start_city: '黄山市',
      start_date: d1,
      end_date: d2,
      gradient: 0,
      budget: 8000,
      owner_id: OWNER.id,
      members: [
        { ...OWNER },
        { id: 'u-m2', name: '林一' },
        { id: 'u-m3', name: '苏晚' },
        { id: 'u-m4', name: '大熊' }
      ],
      viewers: [{ id: 'u-v1', name: '远方的周周' }],
      seed: true
    },
    {
      id: 'demo-plan-mg',
      name: '周末 · 莫干山环湖',
      destination: '浙江 · 莫干山',
      start_city: '湖州市',
      start_date: isoPlus(1),
      end_date: isoPlus(2),
      gradient: 1,
      budget: 1200,
      owner_id: OWNER.id,
      members: [{ ...OWNER }],
      viewers: [],
      seed: true
    }
  ]

  const content = {
    'demo-plan-hui': {
      days: [
        {
          id: 'd-1',
          date: d1,
          title: '合肥 → 黄山市区',
          destinations: [
            { id: 'x1', time: '10:30', place: '黄山北站 · 取车', note: '一嗨租车,提前 APP 下单,证件带齐' },
            { id: 'x2', time: '12:00', place: '屯溪老街 · 觅食', note: '毛豆腐 & 臭鳜鱼,车停老街停车场(¥8/次)' },
            { id: 'x3', time: '15:30', place: '新安江山水画廊', note: '沿江公路风景很好,记得加满油' }
          ]
        },
        {
          id: 'd-2',
          date: isoPlus(16),
          title: '汤口镇 · 黄山风景区',
          destinations: [
            { id: 'x4', time: '08:00', place: '南大门换乘中心', note: '门票+索道票提前在官方小程序买好' },
            { id: 'x5', time: '16:30', place: '汤口镇入住', note: '民宿老板可代订下山小交通' }
          ]
        },
        {
          id: 'd-3',
          date: isoPlus(17),
          title: '宏村 · 塔川秋色',
          destinations: [
            { id: 'x6', time: '09:30', place: '宏村景区', note: '南湖画桥日出时段人少光好' },
            { id: 'x7', time: '14:00', place: '塔川村', note: '秋色最佳机位在观景台上方公路' }
          ]
        },
        {
          id: 'd-4',
          date: isoPlus(18),
          title: '返程',
          destinations: [
            { id: 'x8', time: '09:00', place: '返程 · 京台高速', note: '提前 2 小时出发避开周末拥堵' }
          ]
        }
      ],
      stays: [
        {
          id: 's1', type: 'stay', name: '全季酒店(屯溪老街店)',
          address: '黄山市屯溪区延安路 8 号',
          phone: '0559-2512345', tags: ['免费停车'], booked: true
        },
        {
          id: 's2', type: 'food', name: '胡记徽菜馆',
          address: '屯溪老街 123 号', phone: '13812345678',
          tags: ['人均¥85', '徽州菜'], booked: false
        },
        {
          id: 's3', type: 'stay', name: '黄山泊隐云宿',
          address: '汤口镇山岔村(近南大门)',
          phone: '0559-5566778', tags: ['含早', '可停车'], booked: true
        },
        {
          id: 's4', type: 'food', name: '宏村 · 聚缘土菜馆',
          address: '宏村镇际村桥头', phone: '13911112222',
          tags: ['人均¥70', '笋干烧肉一绝'], booked: false
        }
      ],
      todos: [
        { id: 't1', title: '整理驾驶证、行驶证与保单', done: true, due: '' },
        { id: 't2', title: '检查车况 · 补足玻璃水', done: false, due: '' },
        { id: 't3', title: '预订黄山风景区门票', done: false, due: isoPlus(3) },
        { id: 't4', title: '购买自驾游意外险', done: false, due: isoPlus(5) },
        { id: 't5', title: '下载安徽离线地图', done: true, due: '' },
        { id: 't6', title: '确认民宿入住人数与餐食', done: false, due: isoPlus(10) }
      ],
      guides: [
        {
          id: 'g1', title: '黄山看日出全攻略(路线+机位)',
          url: 'https://www.bilibili.com/video/example01',
          image: 'https://picsum.photos/seed/hs01/520/340', created_at: isoDateTime(-6)
        },
        {
          id: 'g2', title: '皖南小川藏线自驾路线图',
          url: 'https://www.xiaohongshu.com/explore/example02',
          image: 'https://picsum.photos/seed/hs02/400/560', created_at: isoDateTime(-4)
        },
        {
          id: 'g3', title: '宏村拍摄穿搭与慢门技巧',
          url: 'https://www.zhihu.com/question/example03',
          image: 'https://picsum.photos/seed/hs03/500/360', created_at: isoDateTime(-1)
        }
      ],
      reminders: [
        { id: 'r1', title: '出发前检查轮胎气压', date: today, time: '12:00', read: false },
        { id: 'r2', title: '把最终行程单发到群里', date: today, time: '21:00', read: true },
        { id: 'r3', title: '联系宏村民宿确认入住', date: isoPlus(1), time: '08:30', read: false },
        { id: 'r4', title: '预约返程前洗车', date: isoPlus(14), time: '16:00', read: false }
      ],
      // —— 大交通企划(五湖四海 → 集合点):每人的 到达 / 离开 段
      transits: [
        { id: 'tr1', person: OWNER, direction: 'in', mode: 'car', from_city: '合肥', to_city: '黄山', leg_date: d1, time: '07:30', ref_no: '', note: '自驾集合出发,市区接上林一苏晚' },
        { id: 'tr2', person: { id: 'u-m2', name: '林一' }, direction: 'in', mode: 'train', from_city: '杭州东', to_city: '黄山北', leg_date: isoPlus(14), time: '17:32', ref_no: 'G7311', note: '周四晚班车' },
        { id: 'tr3', person: { id: 'u-m3', name: '苏晚' }, direction: 'in', mode: 'flight', from_city: '上海虹桥', to_city: '黄山屯溪', leg_date: isoPlus(14), time: '19:15', ref_no: 'MU 9137' },
        { id: 'tr4', person: { id: 'u-m4', name: '大熊' }, direction: 'in', mode: 'flight', from_city: '北京首都', to_city: '黄山屯溪', leg_date: isoPlus(14), time: '20:45', ref_no: 'CZ 3921' },
        { id: 'tr5', person: OWNER, direction: 'out', mode: 'car', from_city: '黄山', to_city: '合肥', leg_date: isoPlus(19), time: '09:00', ref_no: '', note: '返程不赶路,服务区午饭' },
        { id: 'tr6', person: { id: 'u-m2', name: '林一' }, direction: 'out', mode: 'train', from_city: '黄山北', to_city: '杭州东', leg_date: isoPlus(19), time: '12:10', ref_no: 'G7490' },
        { id: 'tr7', person: { id: 'u-m3', name: '苏晚' }, direction: 'out', mode: 'flight', from_city: '黄山屯溪', to_city: '上海虹桥', leg_date: isoPlus(19), time: '16:30', ref_no: 'MU 9138' },
        { id: 'tr8', person: { id: 'u-m4', name: '大熊' }, direction: 'out', mode: 'flight', from_city: '黄山屯溪', to_city: '北京首都', leg_date: isoPlus(19), time: '16:30', ref_no: 'CZ 3922' }
      ],
      // —— 车辆与里程
      vehicle: [{ id: 'veh1', name: '小白 · 探岳', plate: '皖A·8X93H' }],
      fuel: [
        { id: 'fl1', date: isoPlus(12), odometer: 32140, liters: 45.6, amount: 360, note: '出发前满箱' },
        { id: 'fl2', date: isoPlus(16), odometer: 32560, liters: 38.2, amount: 305, note: '汤口镇中石化' }
      ],
      // —— 分账(与食宿/行程联动)
      bills: [
        {
          id: 'b1', name: '全季酒店 2 晚 · 双床房', amount: 620, category: 'stay',
          paid_by: { id: 'u-m2', name: '林一' },
          involves: [OWNER, { id: 'u-m2', name: '林一' }, { id: 'u-m3', name: '苏晚' }, { id: 'u-m4', name: '大熊' }],
          link: { type: 'stay', id: 's1', name: '全季酒店(屯溪老街店)' },
          note: '两间双床房拼住', created_at: isoDateTime(-8)
        },
        {
          id: 'b2', name: '屯溪老街午餐 · 胡记', amount: 208, category: 'food',
          paid_by: { id: 'u-m3', name: '苏晚' },
          involves: [OWNER, { id: 'u-m2', name: '林一' }, { id: 'u-m3', name: '苏晚' }],
          link: { type: 'dest', id: 'x2', name: '屯溪老街 · 觅食' },
          created_at: isoDateTime(-3)
        },
        {
          id: 'b3', name: '租车油费(取车→市区)', amount: 400, category: 'fuel',
          paid_by: { id: 'u-m4', name: '大熊' },
          involves: [OWNER, { id: 'u-m2', name: '林一' }, { id: 'u-m3', name: '苏晚' }, { id: 'u-m4', name: '大熊' }],
          created_at: isoDateTime(-2)
        },
        {
          id: 'b4', name: '黄山风景区门票 ×4', amount: 760, category: 'ticket',
          paid_by: { id: 'u-demo-owner', name: '阿澈' },
          involves: [OWNER, { id: 'u-m2', name: '林一' }, { id: 'u-m3', name: '苏晚' }, { id: 'u-m4', name: '大熊' }],
          link: { type: 'dest', id: 'x4', name: '南大门换乘中心' },
          created_at: isoDateTime(-1)
        }
      ],
      // —— 行程建议评论(状态流转:open → accepted → done)
      comments: [
        {
          id: 'c1', day_date: d1, dest_id: 'x2', text: '老街口那家「胡记」人很多,建议 11:30 前到店占座。',
          author: { id: 'u-m2', name: '林一' }, status: 'open', created_at: isoDateTime(-5)
        },
        {
          id: 'c2', day_date: d1, dest_id: 'x2', text: '把觅食提前到 11:30,错峰去第二家徽菜馆打卡。',
          author: { id: 'u-m3', name: '苏晚' }, status: 'accepted',
          accepted_by: { id: 'u-demo-owner', name: '阿澈' }, accepted_at: isoDateTime(-4),
          created_at: isoDateTime(-5)
        },
        {
          id: 'c3', day_date: isoPlus(16), dest_id: 'x4', text: '索道旺季排队久,已全员同意 8 点前到换乘中心。',
          author: OWNER, status: 'done', accepted_by: { id: 'u-m2', name: '林一' },
          accepted_at: isoDateTime(-3), done_at: isoDateTime(-2), created_at: isoDateTime(-4)
        }
      ]
    },
    'demo-plan-mg': {
      days: [
        {
          id: 'd-m1',
          date: isoPlus(1),
          title: '莫干山 · 裸心谷环线',
          destinations: [{ id: 'xm1', time: '10:00', place: '莫干山游客集散中心', note: '周末建议 9 点前到,车位紧张' }]
        }
      ],
      stays: [
        {
          id: 'sm1', type: 'stay', name: '莫干山麓隐民宿',
          address: '德清县筏头乡', phone: '0572-8822333',
          tags: [], booked: true
        },
        {
          id: 'sm2', type: 'food', name: '庾村广场面馆',
          address: '莫干山镇庾村', phone: '', tags: ['人均¥35'], booked: false
        }
      ],
      todos: [{ id: 'tm1', title: '确认民宿宠物能否入住', done: false, due: '' }],
      guides: [
        {
          id: 'gm1', title: '莫干山骑行路线推荐',
          url: 'https://www.mafengwo.cn/example', image: '', created_at: isoDateTime(-2)
        }
      ],
      reminders: [
        { id: 'rm1', title: '检查民宿退订政策', date: today, time: '19:00', read: false }
      ],
      bills: [],
      comments: []
    }
  }

  return { plans, content }
}

const today = isoPlus(0)

/** 相对天数的完整时间戳(用于收藏/评论时间) */
function isoDateTime(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString()
}
