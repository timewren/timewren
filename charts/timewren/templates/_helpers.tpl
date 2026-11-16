{{- define "timewren.name" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 40 | trimSuffix "-" -}}
{{- end -}}

{{- define "timewren.labels" -}}
app.kubernetes.io/name: timewren
app.kubernetes.io/instance: {{ .Release.Name | quote }}
{{- end -}}

{{- define "timewren.secretName" -}}
{{- default (include "timewren.name" .) .Values.existingSecret -}}
{{- end -}}
