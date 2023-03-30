import React, { ChangeEvent } from 'react';
import { InlineField, Input } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { MyDataSourceOptions } from '../types';

interface Props extends DataSourcePluginOptionsEditorProps<MyDataSourceOptions> {}

export function ConfigEditor(props: Props) {
  const { onOptionsChange, options } = props;
  const onUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    const jsonData = {
      ...options.jsonData,
      url: event.target.value,
    };
    onOptionsChange({ ...options, jsonData });
  };

  const { jsonData } = options;

  return (
    <div className="gf-form-group">
      <InlineField label="URL" labelWidth={12} tooltip="The URL for accessing the Zed lake service. The default should work if you've got the Zui app open locally or are running 'zed serve' locally with default settings.">
        <Input
          onChange={onUrlChange}
          value={jsonData.url || ''}
          placeholder="http://localhost:9867"
          width={40}
        />
      </InlineField>
    </div>
  );
}
