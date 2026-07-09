import type { ElementType } from "react"
import {
  LayoutDashboard, Package, FolderTree, Wallet, Boxes, Factory,
  TrendingUp, CalendarClock, UserRound, Users, Images, ShoppingBag,
  Receipt, ClipboardCheck, Layers, AlertTriangle, Store, TrendingDown,
  BarChart2, Printer, FlaskConical, FileBarChart, Megaphone, PieChart,
  Settings, Signal,
} from "lucide-react"

// Lista única das páginas do menu — usada pela Sidebar (renderizar/filtrar), pela tela
// de Usuários (checkboxes de permissão) e pelo middleware (decidir a primeira página
// liberada de cada usuário). Ficar num módulo só evita as 3 pontas desalinharem.

export type NavItem = { href: string; label: string; icon: ElementType }

export const navTop: NavItem[] = [
  { href: "/dashboard",                         label: "Dashboard",       icon: LayoutDashboard },
  { href: "/dashboard/pdv",                     label: "PDV de Vendas",   icon: Store           },
  { href: "/dashboard/autoatendimento/pedidos", label: "Autoatendimento", icon: ShoppingBag     },
  { href: "/dashboard/marketing",               label: "Marketing",       icon: Megaphone       },
  { href: "/dashboard/mapa-operacao",           label: "Mapa da Operação", icon: Signal         },
]

export const navGestao: NavItem[] = [
  { href: "/dashboard/categorias",      label: "Categorias",         icon: FolderTree    },
  { href: "/dashboard/produtos",        label: "Produtos",           icon: Package       },
  { href: "/dashboard/estoque",         label: "Estoque",            icon: Boxes         },
  { href: "/dashboard/estoque-avarias", label: "Estoque de Avarias", icon: AlertTriangle },
]

export const navFinanceiro: NavItem[] = [
  { href: "/dashboard/relatorio-vendas",     label: "Relatório de Vendas",   icon: BarChart2    },
  { href: "/dashboard/relatorio-financeiro", label: "Relatório Financeiro",  icon: PieChart     },
  { href: "/dashboard/clientes-a-receber",   label: "Clientes a Receber",    icon: Receipt      },
  { href: "/dashboard/custo-operacional",    label: "Custo Operacional",     icon: Wallet       },
  { href: "/dashboard/custo-variavel",       label: "Custo Variável",        icon: TrendingDown },
]

export const navDTF: NavItem[] = [
  { href: "/dashboard/dtf/pedidos",   label: "Dashboard DTF", icon: Printer      },
  { href: "/dashboard/dtf/insumos",   label: "Insumos",       icon: FlaskConical },
  { href: "/dashboard/dtf/relatorio", label: "Relatório DTF", icon: FileBarChart },
]

export const navProducao: NavItem[] = [
  { href: "/dashboard/metricas",        label: "Métricas Produção x Vendas", icon: TrendingUp     },
  { href: "/dashboard/materias-primas", label: "Matéria Prima",              icon: Layers         },
  { href: "/dashboard/programacao",     label: "Programação de Produção",    icon: CalendarClock  },
  { href: "/dashboard/custo-producao",  label: "Custos de Produção",         icon: Factory        },
  { href: "/dashboard/costura-revisao", label: "Costura e Revisão",          icon: ClipboardCheck },
]

export const navCadastros: NavItem[] = [
  { href: "/dashboard/clientes", label: "Clientes", icon: UserRound },
  { href: "/dashboard/usuarios", label: "Usuários", icon: Users     },
]

export const navLP: NavItem[] = [
  { href: "/dashboard/catalogo", label: "Produtos na LP", icon: Images },
]

export const navSistema: NavItem[] = [
  { href: "/dashboard/settings", label: "Configurações", icon: Settings },
]

// Ordem canônica de todas as páginas — usada pra achar a "primeira" liberada de um
// usuário, na mesma ordem em que elas aparecem na barra lateral.
export const ALL_NAV_ITEMS: NavItem[] = [
  ...navTop, ...navGestao, ...navFinanceiro, ...navDTF,
  ...navProducao, ...navCadastros, ...navLP, ...navSistema,
]

// Primeira página (na ordem do menu) que o usuário pode acessar — admin sempre cai
// no Dashboard. Retorna null se não sobrar nenhuma (usuário sem nada liberado).
export function firstAllowedPage(isAdmin: boolean, allowedPages: string[]): string | null {
  if (isAdmin) return "/dashboard"
  const match = ALL_NAV_ITEMS.find(item => allowedPages.includes(item.href))
  return match?.href ?? null
}
