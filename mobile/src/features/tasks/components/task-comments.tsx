import { Send } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Card, ErrorState, IconButton, Input, SectionHeader, Text } from '~/components/ui';
import { errorMessage, trpc } from '~/lib/api';
import { formatAgo } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { plainTextToComment, stripHtml } from '../task-logic';

/** Kommentartråd på en opgave: liste + simpelt tekstfelt (web's tiptap-format bevares). */
export function TaskComments({ taskId }: { taskId: string }) {
  const [text, setText] = React.useState('');
  const utils = trpc.useUtils();
  const comments = trpc.taskComments.list.useQuery({ taskId });
  const create = trpc.taskComments.create.useMutation({
    onSuccess: () => {
      setText('');
      void utils.taskComments.list.invalidate({ taskId });
    },
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });

  const submit = () => {
    if (!text.trim())
      return;
    create.mutate({ taskId, ...plainTextToComment(text) });
  };

  return (
    <>
      <SectionHeader title={translate('tasks.comments')} />
      <Card className="p-0">
        {comments.isError
          ? <ErrorState onRetry={comments.refetch} />
          : (comments.data ?? []).length === 0
              ? <Text className="p-4 text-sm text-muted-foreground" tx="tasks.no_comments" />
              : comments.data?.map(c => (
                  <View key={c.id} className="border-b border-border px-4 py-3">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm font-medium text-foreground">{c.user?.name ?? ''}</Text>
                      <Text className="text-xs text-muted-foreground">{formatAgo(c.createdAt)}</Text>
                    </View>
                    <Text className="mt-1 text-sm text-foreground">{stripHtml(c.contentHtml)}</Text>
                  </View>
                ))}
        <View className="flex-row items-end gap-2 px-3 pt-3">
          <View className="flex-1">
            <Input
              value={text}
              onChangeText={setText}
              placeholder={translate('tasks.add_comment')}
              multiline
              testID="task-comment-input"
            />
          </View>
          <IconButton icon={Send} label={translate('tasks.add_comment')} variant="primary" onPress={submit} disabled={!text.trim() || create.isPending} className="mb-2" testID="task-comment-send" />
        </View>
      </Card>
    </>
  );
}
