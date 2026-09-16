import DashboardList from "./DashboardList";
import DashboardCharts from "./DashboardCharts";
import InsightPanel from "../Insight/InsightPanel";

// <Dashboard /> : 항상 존재하는 레이어(히어로가 그 위에 겹쳐 있다가 걷힐 뿐).
// 왼쪽 관심 매물 리스트는 고정이고, 오른쪽만 .content-track-viewport로 감싸
// 상세 데이터(DashboardCharts)/인사이트(InsightPanel) 두 패널을 좌우로
// 슬라이드한다(globals.css의 .content-track/.content-panel, is-insight 시
// translateX(-50%)) - 헤더의 상세 데이터/인사이트 메뉴와 짝을 이룬다.
export default function Dashboard({
  items,
  totalCount,
  insightItems,
  userId,
  profile,
  onToggle,
  onEdit,
  onRemove,
  onReorder,
  onAdd,
  activeContentTab,
  dragDisabled,
}) {
  return (
    <div className="dashboard" data-component="Dashboard">
      <DashboardList
        items={items}
        totalCount={totalCount}
        onToggle={onToggle}
        onEdit={onEdit}
        onRemove={onRemove}
        onReorder={onReorder}
        onAdd={onAdd}
        dragDisabled={dragDisabled}
      />
      <div className="content-track-viewport">
        <div
          className={
            "content-track" + (activeContentTab === "insight" ? " is-insight" : "")
          }
        >
          <div className="content-panel content-panel--detail">
            <DashboardCharts items={items} />
          </div>
          <div className="content-panel content-panel--insight">
            <InsightPanel
              items={insightItems}
              userId={userId}
              profile={profile}
              referenceSizeId={items[0]?.sizeId}
              refreshKey={JSON.stringify(items.map(item => [item.id, item.sizeId]))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
