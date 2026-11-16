import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { LocalRow, TimesheetWeek } from '../timesheet-logic';
import * as React from 'react';
import { View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Button, ColorDot, colors, EmptyState, ListRow, Modal, Text } from '~/components/ui';
import { BottomSheetScrollView } from '~/components/ui/bottom-sheet';
import { translate } from '~/lib/i18n';
import { allowedActivities } from '../timesheet-logic';

type AddRowSheetProps = {
  ref: React.RefObject<BottomSheetModal | null>;
  week: Pick<TimesheetWeek, 'projects' | 'activityTypes' | 'allowedActivitiesByProject'> | undefined;
  onAdd: (row: LocalRow) => void;
};

/** To trin: vælg projekt → (hvis org'en har aktivitetstyper) vælg aktivitet. */
export function AddRowSheet({ ref, week, onAdd }: AddRowSheetProps) {
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const project = week?.projects.find(p => p.id === projectId) ?? null;
  const hasActivities = (week?.activityTypes.length ?? 0) > 0;

  const finish = (row: LocalRow) => {
    onAdd(row);
    setProjectId(null);
    ref.current?.dismiss();
  };

  const pickProject = (id: string) => {
    if (hasActivities)
      setProjectId(id);
    else
      finish({ projectId: id, activityTypeId: null });
  };

  return (
    <Modal
      ref={ref}
      snapPoints={['70%']}
      title={project ? translate('enterprise.timesheet.activity') : translate('enterprise.timesheet.project')}
      onDismiss={() => setProjectId(null)}
      backgroundStyle={{ backgroundColor: dark ? colors.neutral[900] : colors.white }}
    >
      <BottomSheetScrollView contentContainerClassName="px-4 pb-8">
        {project
          ? (
              <>
                <Text className="mb-2 text-sm text-muted-foreground">{project.name}</Text>
                <View className="overflow-hidden rounded-2xl border border-border">
                  {allowedActivities(week!, project.id).map((a, i, arr) => (
                    <ListRow
                      key={a.id}
                      title={a.name}
                      left={<ColorDot color={a.color} />}
                      onPress={() => finish({ projectId: project.id, activityTypeId: a.id })}
                      chevron={false}
                      last={i === arr.length - 1}
                      testID={`add-row-activity-${a.id}`}
                    />
                  ))}
                </View>
                <Button variant="ghost" size="sm" label={translate('enterprise.common.cancel')} onPress={() => setProjectId(null)} />
              </>
            )
          : week && week.projects.length > 0
            ? (
                <View className="overflow-hidden rounded-2xl border border-border">
                  {week.projects.map((p, i, arr) => (
                    <ListRow
                      key={p.id}
                      title={p.name}
                      onPress={() => pickProject(p.id)}
                      chevron={hasActivities}
                      last={i === arr.length - 1}
                      testID={`add-row-project-${p.id}`}
                    />
                  ))}
                </View>
              )
            : (
                <EmptyState
                  title={translate('enterprise.timesheet.no_projects')}
                  description={translate('enterprise.timesheet.no_projects_body')}
                  compact
                />
              )}
      </BottomSheetScrollView>
    </Modal>
  );
}
