import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardCharts } from "./DashboardCharts";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@iconify/react", () => ({
  Icon: ({ icon, ...props }: { icon: string } & Record<string, unknown>) => <span data-icon={icon} {...props} />,
}));

vi.mock("@/components/admin/dashboard", () => ({
  VisitTrendChart: () => <div data-testid="visit-trend-chart" />,
  SourceChart: () => <div data-testid="source-chart" />,
  DeviceChart: () => <div data-testid="device-chart" />,
}));

const itemVariants = {};

describe("DashboardCharts", () => {
  it("分类和标签快捷统计入口指向已有的文章分类标签管理入口", () => {
    const { container } = render(
      <DashboardCharts
        trendChartData={[]}
        sourceChartData={[]}
        deviceChartData={[]}
        contentStats={{
          total_categories: 10,
          total_tags: 1121,
          pending_comments: 2,
          draft_articles: 3,
        }}
        queries={{ summary: { isLoading: false } }}
        itemVariants={itemVariants}
      />
    );

    const hrefs = Array.from(container.querySelectorAll("a")).map(link => link.getAttribute("href"));

    expect(hrefs).toContain("/admin/post-management?manage=taxonomy&tab=categories");
    expect(hrefs).toContain("/admin/post-management?manage=taxonomy&tab=tags");
    expect(hrefs).not.toContain("/admin/categories");
    expect(hrefs).not.toContain("/admin/tags");
  });
});
