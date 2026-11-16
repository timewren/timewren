import type { PickedImage } from '../attachment-logic';
import type { RouterOutputs } from '~/api/app-router';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, X } from 'lucide-react-native';
import * as React from 'react';
import { Alert, Linking, Pressable, ScrollView } from 'react-native';
import { Button, Card, colors, EmptyState, Image, SectionHeader, Text } from '~/components/ui';
import { errorMessage, trpc } from '~/lib/api';
import { postTaskImage } from '~/lib/api/upload';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { errorTx, isPickableImageType, uploadTaskImage } from '../attachment-logic';

type Attachment = RouterOutputs['tasks']['listAttachments'][number];

/** Konverterer til jpeg i den bredde serveren ville skalere til. */
async function toJpeg(uri: string): Promise<string> {
  const result = await manipulateAsync(uri, [{ resize: { width: 1920 } }], { compress: 0.9, format: SaveFormat.JPEG });
  return result.uri;
}

function useAttachments(taskId: string) {
  const utils = trpc.useUtils();
  const list = trpc.tasks.listAttachments.useQuery({ taskId });
  const onError = (error: unknown) => showMessage({ message: errorMessage(error), type: 'danger' });
  const invalidate = () => void utils.tasks.listAttachments.invalidate({ taskId });
  const add = trpc.tasks.addAttachment.useMutation({ onSuccess: invalidate, onError });
  const remove = trpc.tasks.deleteAttachment.useMutation({
    onSuccess: () => {
      invalidate();
      showMessage({ message: translate('tasks.attachments_deleted_ok'), type: 'success' });
    },
    onError,
  });
  return { list, add, remove, invalidate };
}

function usePickAndUpload(taskId: string, deps: ReturnType<typeof useAttachments>) {
  const { add, invalidate } = deps;
  const [busy, setBusy] = React.useState(false);

  const attach = React.useCallback(async (picked: PickedImage) => {
    if (!isPickableImageType(picked.mimeType)) {
      showMessage({ message: translate(errorTx('unsupported')), type: 'danger' });
      return;
    }
    const outcome = await uploadTaskImage(picked, { post: postTaskImage });
    if (!outcome.ok) {
      showMessage({ message: translate(errorTx(outcome.kind)), type: 'danger' });
      return;
    }
    // Først når serveren har billedet, gemmer vi kæden — ellers ville en
    // afbrudt mutation efterlade et billede, ingen kan se.
    await add.mutateAsync({
      taskId,
      fileName: outcome.image.fileName,
      contentType: 'image/jpeg',
      sizeBytes: outcome.image.sizeBytes,
      storageUrl: outcome.image.url,
    });
    showMessage({ message: translate('tasks.attachments_added_ok'), type: 'success' });
    invalidate();
  }, [add, invalidate, taskId]);

  const pick = React.useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showMessage({ message: translate('tasks.attachments_error.permission'), type: 'danger' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled)
      return;
    const asset = result.assets[0];
    if (!asset)
      return;
    setBusy(true);
    try {
      // Konverter før upload: serveren afviser alt uden de fire jpeg/png/webp/gif,
      // og et iPhone-foto er som regel HEIC.
      // Ingen egen størrelseskontrol: serveren måler den *konverterede* fil, så et
      // 12 MB-foto der bliver 2 MB ville være afvist for tidligt. Serverens 400
      // kommer tilbage som 'rejected'.
      const converted = await toJpeg(asset.uri);
      await attach({ uri: converted, fileName: asset.fileName ?? null, mimeType: asset.mimeType ?? null });
    }
    catch {
      showMessage({ message: translate(errorTx('upload_failed')), type: 'danger' });
    }
    finally {
      setBusy(false);
    }
  }, [attach]);

  return { pick, busy: busy || add.isPending };
}

export function TaskAttachments({ taskId }: { taskId: string }) {
  const deps = useAttachments(taskId);
  const { list, remove } = deps;
  const { pick, busy } = usePickAndUpload(taskId, deps);
  // `storageUrl` er nullable i databasen, men et billede uden URL kan ikke vises.
  const images = (list.data ?? []).filter(a => !!a.storageUrl) as (Attachment & { storageUrl: string })[];

  const confirmDelete = (attachment: Attachment) =>
    Alert.alert(translate('tasks.attachments'), translate('tasks.attachments_confirm_delete'), [
      { text: translate('tasks.cancel'), style: 'cancel' },
      { text: translate('tasks.delete_attachment'), style: 'destructive', onPress: () => remove.mutate({ id: attachment.id }) },
    ]);

  return (
    <>
      <SectionHeader title={translate('tasks.attachments')} />
      <Text className="mb-2 text-sm text-muted-foreground">{translate('tasks.attachments_hint')}</Text>
      {list.isError
        ? <Text className="text-sm text-danger-600 dark:text-danger-400">{errorMessage(list.error)}</Text>
        : images.length === 0
          ? <EmptyState icon={ImagePlus} title={translate('tasks.attachments_empty')} compact />
          : <AttachmentStrip images={images} onOpen={url => void Linking.openURL(url)} onDelete={confirmDelete} />}
      <Button
        className="mt-3"
        variant="secondary"
        label={busy ? translate('tasks.attachments_uploading') : translate('tasks.attachments_add')}
        onPress={() => void pick()}
        loading={busy}
        disabled={busy}
        testID="task-attachment-add"
      />
    </>
  );
}

function AttachmentStrip({ images, onOpen, onDelete }: {
  images: (Attachment & { storageUrl: string })[];
  onOpen: (url: string) => void;
  onDelete: (attachment: Attachment) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {images.map(attachment => (
        <Card key={attachment.id} className="p-1">
          <Pressable
            onPress={() => onOpen(attachment.storageUrl)}
            onLongPress={() => onDelete(attachment)}
            accessibilityRole="imagebutton"
            accessibilityLabel={attachment.filename}
            accessibilityHint={translate('tasks.attachments_open_hint')}
            testID={`task-attachment-${attachment.id}`}
          >
            <Image source={{ uri: attachment.storageUrl }} style={{ width: 96, height: 96, borderRadius: 8 }} contentFit="cover" transition={150} />
          </Pressable>
          <Pressable
            onPress={() => onDelete(attachment)}
            accessibilityRole="button"
            accessibilityLabel={translate('tasks.delete_attachment')}
            hitSlop={14}
            className="absolute -top-2 -right-2 rounded-full bg-card p-2"
            testID={`task-attachment-delete-${attachment.id}`}
          >
            <X size={16} color={colors.danger[500]} />
          </Pressable>
        </Card>
      ))}
    </ScrollView>
  );
}
