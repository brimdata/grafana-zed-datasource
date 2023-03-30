import React, { ChangeEvent } from 'react';
import { InlineField, Input, TextArea} from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { DataSource } from '../datasource';
import { MyDataSourceOptions, MyQuery } from '../types';

type Props = QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>;

export function QueryEditor({ query, onChange, onRunQuery }: Props) {
  const onPoolChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...query, pool: event.target.value });
  };

  const onTimeFieldChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...query, timeField: event.target.value });
  };

  const onQueryTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ ...query, queryText: event.target.value });
  };

  const { pool, queryText, timeField } = query;

  return (
    <div>
      <div className="gf-form">
        <InlineField label="From" tooltip="The name of the pool from which to do pull data in 'poolname[@branch]' syntax.">
          <Input onChange={onPoolChange} value={pool || ''} width={30} />
        </InlineField>
        <InlineField label="Time Field" tooltip="The name of a field that stores time values. Ideally this field should be a pool key.">
          <Input onChange={onTimeFieldChange} value={timeField || ''} width={30} placeholder="ts"/>
        </InlineField>
      </div>
      <div className="gf-form">
        <button style={{ background: '#F8771B', color: 'black' }} onClick={onRunQuery}>
          Run Queries
        </button>
        <TextArea onChange={onQueryTextChange} label="Zed Query" value={queryText || ''} placeholder="*" />
      </div>
   </div>
  );
}
