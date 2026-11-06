import type { ElementType } from "react"
import {
  LayoutDashboard, Package, FolderTree, Wallet, Boxes,
  UserRound, Users, ShoppingBag,
  Receipt, Store, TrendingDown,
  BarChart2, Printer, FlaskConical, FileBarChart, Megaphone, PieChart,
  Settings, Signal, CalendarDays, ShoppingCart, FileText, ClipboardList, Undo2, LineChart, ClipboardPen,
} from "lucide-react"

// Lista única das páginas do menu — usada pela Sidebar (renderizar/filtrar), pela tela
// de Usuários (checkboxes de permissão) e pelo middleware (decidir a primeira página
// liberada de cada usuário). Ficar num módulo só evita as 3 pontas desalinharem.

export type NavItem = { href: string; label: string; icon: ElementType }

// Painel reorganizado (PIV 05/11): saíram a Produção inteira (Programação, Costura e
// Revisão, Matéria Prima, Custos de Produção, Métricas, Metas), as Avarias, o Fechamento
// e o Relatórios repetido. Grupos por trabalho do dia a dia.
export type NavGroup = { label: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  { label: "Início", items: [
    { href: "/dashboard",                         label: "Dashboard",          icon: LayoutDashboard },
    { href: "/dashboard/mapa-operacao",           label: "Mapa da Operação",   icon: Signal          },
  ] },
  { label: "Vendas", items: [
    { href: "/dashboard/pdv",                     label: "PDV de Vendas",      icon: Store           },
    { href: "/dashboard/autoatendimento/pedidos", label: "Autoatendimento",    icon: ShoppingBag     },
    { href: "/dashboard/clientes",                label: "Clientes",           icon: UserRound       },
    { href: "/dashboard/formularios",             label: "Cadastros do site",  icon: ClipboardList   },
  ] },
  { label: "Marketplace", items: [
    { href: "/dashboard/marketplace",             label: "Marketplace",        icon: ShoppingCart    },
    { href: "/dashboard/marketplace-painel",      label: "Painel Marketplace", icon: LineChart       },
    { href: "/dashboard/marketplace-lancamentos", label: "Lançamentos",        icon: ClipboardPen    },
    { href: "/dashboard/devolucoes",              label: "Devoluções",         icon: Undo2           },
  ] },
  { label: "Estoque", items: [
    { href: "/dashboard/estoque",                 label: "Estoque",            icon: Boxes           },
    { href: "/dashboard/produtos",                label: "Produtos",           icon: Package         },
    { href: "/dashboard/categorias",              label: "Categorias",         icon: FolderTree      },
  ] },
  { label: "Financeiro", items: [
    { href: "/dashboard/relatorio-vendas",        label: "Relatório de Vendas",  icon: BarChart2     },
    { href: "/dashboard/relatorio-financeiro",    label: "Relatório Financeiro", icon: PieChart      },
    { href: "/dashboard/clientes-a-receber",      label: "Clientes a Receber",   icon: Receipt       },
    { href: "/dashboard/contas-a-pagar",          label: "Contas a Pagar",       icon: CalendarDays  },
    { href: "/dashboard/custo-operacional",       label: "Custo Operacional",    icon: Wallet        },
    { href: "/dashboard/custo-variavel",          label: "Custo Variável",       icon: TrendingDown  },
    { href: "/dashboard/notas-fiscais",           label: "Notas Fiscais",        icon: FileText      },
  ] },
  { label: "DTF", items: [
    { href: "/dashboard/dtf/pedidos",             label: "Dashboard DTF",      icon: Printer         },
    { href: "/dashboard/dtf/relatorio",           label: "Relatório DTF",      icon: FileBarChart    },
    { href: "/dashboard/dtf/insumos",             label: "Insumos DTF",        icon: FlaskConical    },
  ] },
  { label: "Marketing", items: [
    { href: "/dashboard/marketing",               label: "Marketing",          icon: Megaphone       },
  ] },
  { label: "Sistema", items: [
    { href: "/dashboard/usuarios",                label: "Usuários",           icon: Users           },
    { href: "/dashboard/settings",                label: "Configurações",      icon: Settings        },
  ] },
]

// Abas que são só valor em R$: sem a permissão "Ver financeiro" somem do menu e o
// middleware não deixa abrir, mesmo marcadas na tela de Usuários.
export const FINANCE_PAGES: string[] = [
  ...NAV_GROUPS.find(g => g.label === "Financeiro")!.items.map(i => i.href),
  "/dashboard/marketplace-painel",
  "/dashboard/marketplace-lancamentos",
]

// Ordem canônica de todas as páginas — usada pra achar a "primeira" liberada de um
// usuário, na mesma ordem em que elas aparecem na barra lateral.
export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items)

// Primeira página (na ordem do menu) que o usuário pode acessar — admin sempre cai
// no Dashboard. Retorna null se não sobrar nenhuma (usuário sem nada liberado).
export function firstAllowedPage(isAdmin: boolean, allowedPages: string[], verFinanceiro = true): string | null {
  if (isAdmin) return "/dashboard"
  const match = ALL_NAV_ITEMS.find(item => allowedPages.includes(item.href) && (verFinanceiro || !FINANCE_PAGES.includes(item.href)))
  return match?.href ?? null
}
