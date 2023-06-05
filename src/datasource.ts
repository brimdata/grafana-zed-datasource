import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  MutableDataFrame,
  FieldType,
  DateTime,
} from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { MyQuery, MyDataSourceOptions } from './types';
import { TypeRecord, Client } from '@brimdata/zed-js';

export class DataSource extends DataSourceApi<MyQuery, MyDataSourceOptions> {
  url: string;

  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);
    this.url = instanceSettings.jsonData.url || 'http://localhost:9867';
    this.annotations = {};
  }

  async doRequest(query: MyQuery, from: DateTime, to: DateTime, options: DataQueryRequest<MyQuery>) {
    const pool = query.pool;
    const zedQuery = query.queryText || '*';
    const timeField = query.timeField || 'ts';
    const rangeFrom = from.toISOString();
    const rangeTo = to.toISOString();
    const zedClient = new Client(this.url);

    if (pool === undefined) {
      const pools = await zedClient.getPools();
      if (pools.length === 0) {
        throw new Error('No pools found in lake at ' + this.url);
      } else {
        throw new Error(
          'Pool must be specified in "From". Available pools in lake at ' +
            this.url +
            ': ' +
            pools.map(p => { return p['name']; }).join(', ')
        );
      }
    }

    const wholeQuery = `from "${pool}" | ${timeField} > ${rangeFrom} and ${timeField} < ${rangeTo} | ${zedQuery} | sort ${timeField}`;
    const finalQuery = getTemplateSrv().replace(wholeQuery, options.scopedVars, 'csv');
    const resultStream = await zedClient.query(finalQuery);
    await resultStream.promise;

    // Before we attempt to build a dataframe out of the query response to hand to
    // Grafana for plotting, we'll check the shapes that were returned alongside the
    // query response.
    const shapes = resultStream.shapes as TypeRecord[];

    // We'll reject any data that came back with multiple shapes since this makes
    // it difficult/impossible to reliably copy the data points from the response
    // into columns in Grafana's data frame.
    if (shapes.length > 1 ) {
      throw new Error('More than one shape detected (consider using "cut" or "fuse")');

    // If there were no shapes at all, it means there's no data to plot. This could
    // have been caused by one of a few things.
    //
    // 1. The query/pool are valid, but the user just has the time range pickers in
    //    Grafana set to a range where there's no data. This is innocuous.
    //
    // 2. The Time Field is not usable for some reason. A common example of this would
    //    be if a user imported JSON data where the Time Field actually contains
    //    string-typed values that look like timestamps, but since they're not of
    //    the genuine Zed "time" type, the time-based filtering done in the query
    //    using the values from Grafana's time range picker will fail to locate any
    //    points. In the future we may come up with some way for the plugin to
    //    transparently cope in such a situation (grafana-zed-datasource/issues/10)
    //    but for now we'll just inform the user of what the plugin saw so they can
    //    shape their data and try again.
    //
    // In order to tell the difference between these two cases we need to execute
    // the following special query focused on just the Time Field.
    } else if (shapes.length === 0) {
      const timeCheckQuery = `from "${pool}" | union(typeof(${timeField}))`;

      const timeCheckStream = await zedClient.query(timeCheckQuery);
      await timeCheckStream.promise;
      const timeCheckResult = await timeCheckStream.js();

      if (timeCheckResult.length === 1 && timeCheckResult[0].length === 1 && timeCheckResult[0][0] === 'time') {
        throw new Error('No data points found to plot in this time range');
      } else {
        throw new Error('Time Field "' + timeField + '" must be Zed <time> type, but detected type(s): ' + timeCheckResult[0].join(', '))
      }
    }

    // Find all the fields that will be added to the data frame. The Time
    // Field is always made the leftmost field since black box testing has
    // indicated that if there's multiple time-typed fields Grafana will use
    // the leftmost one.
    let frameFields: Array<{ name: string; type: FieldType }> = [];
    if (shapes[0] && shapes[0].fields) {
      shapes[0].fields.map(f => {

        if (!('name' in f.type)) {
          throw new Error('Fatal error - Query response contains a Zed type with no name (please open an issue at https://github.com/brimdata/grafana-zed-datasource/issues)');
        }

        // Black box testing has shown that a field named the empty string ""
        // ends up in Grafana with a confusing name in the legend like
        // "Field 2". Therefore we'll handle it as a special case.
        if (f.name === '') {
          f.name = '(empty string)';
        }

        if (f.name === timeField) {
          frameFields.unshift({ name: f.name, type: FieldType.time });
        } else if (
           f.type.name === 'uint16' ||
           f.type.name === 'uint32' ||
           f.type.name === 'uint64' ||
           f.type.name === 'uint128' ||
           f.type.name === 'uint256' ||
           f.type.name === 'int8' ||
           f.type.name === 'int16' ||
           f.type.name === 'int32' ||
           f.type.name === 'int64' ||
           f.type.name === 'int128' ||
           f.type.name === 'int256' ||
           f.type.name === 'float16' ||
           f.type.name === 'float32' ||
           f.type.name === 'float64' ||
           f.type.name === 'float128' ||
           f.type.name === 'float256' ||
           f.type.name === 'decimal32' ||
           f.type.name === 'decimal64' ||
           f.type.name === 'decimal128' ||
           f.type.name === 'decimal256'
        ) {
          frameFields.push({ name: f.name, type: FieldType.number });
        } else if (
          f.type.name === 'string' ||
          f.type.name === 'ip' ||
          f.type.name === 'net' ||
          f.type.name === 'type' ||
          f.type.name === 'bytes' ||
          f.type.name === 'duration'
        ) {
          frameFields.push({ name: f.name, type: FieldType.string });
        } else if (f.type.name === 'time') {
          frameFields.push({ name: f.name, type: FieldType.time });
        } else if (f.type.name === 'bool') {
          frameFields.push({ name: f.name, type: FieldType.boolean });
        }
      });

      return { frameFields: frameFields, response: await resultStream.js() };

    // We don't expect to reach this spot. The "if" above was only there to
    // make TypeScript happy.
    } else {
      throw new Error('Fatal error - Unknown problem with data shape (please open an issue at https://github.com/brimdata/grafana-zed-datasource/issues)');
    }
  }

  async query(options: DataQueryRequest<MyQuery>): Promise<DataQueryResponse> {
    const { range } = options;

    const promises = options.targets.map((query) =>
      this.doRequest(query, range!.from, range!.to, options).then((r) => {

        const frame = new MutableDataFrame({
          refId: query.refId,
          fields: r.frameFields,
        });

        r.response.forEach((point: any) => {
          frame.appendRow(
            r.frameFields.map(function (f) {
              if (f.name === '(empty string)') {
                return point[''];
              } else {
                return point[f.name];
              }
            })
          );
        });

        return frame;
      })
    );

    return Promise.all(promises).then((data) => ({ data }));
  }

  async testDatasource() {
    try {
      const zedClient = new Client(this.url);
      const zedVersionInfo = await zedClient.version();
      return { status: 'success', message: 'Success - Zed lake version ' + zedVersionInfo.version };
    } catch (err) {
      return {
        status: 'error',
        message: 'Failure - Could not contact Zed lake at ' + this.url,
        details: {
          verboseMessage: String(err)
        }
      };
    };
  }
}
