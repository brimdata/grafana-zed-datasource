# Zed Data Source for Grafana

This [data source plugin](https://grafana.com/grafana/plugins/?type=datasource)
for [Grafana](https://grafana.com/) allows the plotting of time-series data
that's stored in [Zed lakes](https://zed.brimdata.io/docs/commands/zed/).

---
  * [Install & Configuration](#install--configuration)
  * [Best Practices](#best-practices)
  * [Example Usage in Dashboards](#example-usage-in-dashboards)
    + [One row per metric](#one-row-per-metric)
    + [Each measurement (with lot of metrics) in its own row](#each-measurement-with-lot-of-metrics-in-its-own-row)
    + [Transform between approaches](#transform-between-approaches)
    + [Variables](#variables)
    + [Aggregations and the `$__interval` variable](#aggregations-and-the-__interval-variable)
    + [Annotations](#annotations)
    + [Logs](#logs)
  * [Debugging](#debugging)
  * [Why Unsigned?](#why-unsigned)
  * [Contributing](#contributing)
  * [Join the Community](#join-the-community)
---

## Quick Start

Want to see if this plugin is what you're looking for? Watch
[this quick video](https://www.youtube.com/watch?v=xxxxxxxx)
to see how easy it is to install the plugin and make your first chart from Zed
data in Grafana. Then keep reading for best practices to plot your
sophisticated, real-world data.

For easy cut & paste, here's the command line used in the video to generate
your own simple test data.

```
NUM=1; while [ $NUM -le 10 ]; do echo $NUM | /opt/Zui/resources/app.asar.unpacked/zdeps/zq -z 'yield {ts: now(), num:this}' -; sleep 1; NUM=`expr $NUM + 1`; done | tee data.zson
```

## Install & Configuration

As an example environment, here the plugin is shown being installed on a fresh
[Grafana installation on Linux](https://grafana.com/docs/grafana/latest/setup-grafana/installation/debian/).
For specifics regarding other platforms or adding a plugin into an existing
environment, refer to the [Grafana documentation](https://grafana.com/docs/grafana/latest/setup-grafana/installation/).


To download and install the latest plugin release, run the following command:

```
sudo grafana-cli \
  --pluginUrl https://github.com/brimdata/grafana-zed-datasource/releases/latest/download/brimdata-zed-datasource.zip \
  plugins install brimdata-zed-datasource
```

As the plugin is not currently signed ([learn why](#why-unsigned)) an
additional [configuration change](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/#allow_loading_unsigned_plugins)
is required to allow the Zed plugin to run. Modify the config file
`/etc/grafana/grafana.ini`, removing the leading semicolon to
uncomment this line and then edit it to read:

```
allow_loading_unsigned_plugins = brimdata-zed-datasource
```

Restart the Grafana service for the modified config to take effect.

```
sudo systemctl restart grafana-server
```

To confirm the plugin has loaded successfully, look for a line like the
following in `/var/log/syslog`.

```
Jun  7 09:37:16 ubuntu-22 grafana[22412]: logger=plugin.loader t=2023-06-07T09:37:16.885366925-07:00 level=info msg="Plugin registered" pluginID=brimdata-zed-datasource
```

Once inside Grafana (default: http://localhost:3000), the Zed data source
can be added by navigating to **Administration > Data Sources > Add data source**,
then click the entry for Zed (typically at the bottom of the list).

If a Zed lake service is listening locally on the default TCP port `9867`
(as is typical for the lake launched by the [Zui app](https://zui.brimdata.io/)
or when [`zed serve`](https://zed.brimdata.io/docs/commands/zed#213-serve) is
run with default settings) the default URL setting can be used. If your lake
is listening elsewhere (e.g., with [Zui Insiders](https://github.com/brimdata/zui-insiders)
it's at http://localhost:9988) change the URL setting as necessary.

When **Save & test** is clicked, the plugin will query the value from
the lake service's `/version` endpoint. If successful, the version will be shown
and the plugin is ready for use in dashboard panel queries.

![Configure and Test Zed Data Source](https://github.com/brimdata/grafana-zed-datasource/raw/main/src/img/config-zed-data-source.png)

## Best Practices

A Zed lake is not a purpose-built time-series database. However, as a general
data platform, it can absolutely be used for storage and query of time-series
data at moderate scale.

In its current state, the plugin relies on the use of Zed queries that
prepare data for easy transformation to the
[data frames](https://grafana.com/docs/grafana/latest/developers/plugins/data-frames/)
that Grafana uses for rendering plots. Some best practices that help achieve this:

1. **The Time Field that contains timestamps for your data must be of Zed's
   `time` type.**

2. **The Time Field should ideally be your
  [pool key](https://zed.brimdata.io/docs/commands/zed#143-pool-key).**

   With this pool configuration, the time range portion of queries initiated
   via the Grafana dashboard will scan the minimal number of data objects in
   the Zed lake relevant to the query.

3. **If possible, use `ts` as the name for your Time Field.**

   This field name matches the "out of the box" default settings for the plugin.
   However, the plugin can easily be configured to adapt to a different field
   name.

4. **Your time-series data should be of a single
   [shape](https://zed.brimdata.io/docs/language/overview#10-shaping).**

   Grafana's columnar data frames need to be constructed with a specific list
   of expected fields. Therefore the count of shapes returned by a query is
   first checked by the plugin and an error is shown if more than one shape is
   detected. If this occurs, this could be addressed by using the
   [`cut` operator](https://zed.brimdata.io/docs/language/operators/cut)
   to trim the set of fields returned by the query or using the
   [`fuse` operator](https://zed.brimdata.io/docs/language/operators/fuse) to
   combine the entire query result into a single, wider shape.

5. **Store data in top-level fields of primitive types.**

   Of the fields in a response to a Zed query, the values passed on to Grafana
   by the plugin will be top-level fields of Zed's
   [primitive types](https://zed.brimdata.io/docs/formats/zed#1-primitive-types).
   If you need to use values from
   [complex Zed types](https://zed.brimdata.io/docs/formats/zed#2-complex-types)
   in Grafana, modify your Zed query to make them available as top-level fields,
   e.g., by using the
   [`put` operator](https://zed.brimdata.io/docs/language/operators/put).

Next we'll walk through some real world examples that leverage these best
practices.

## Example Usage in Dashboards

As [often described](https://kb.altinity.com/altinity-kb-schema-design/best-schema-for-storing-many-metrics-registered-from-the-single-source/),
different schema approaches may be used for storing time-series data. The Zed
plugin can adapt to multiple approaches, but the Zed query used in the Grafana
panel will differ. In each of the following sections we'll plot some sample
time-series data to illustrate the concepts.

### One row per metric

Some example data that uses this approach is the
[weekly fuel prices (all data)](https://dgsaie.mise.gov.it/open_data_export.php?export-id=4&export-type=csv)
link in the [Italian fuel price data](https://dgsaie.mise.gov.it/open-data), which is freely
available under the [IODL 2.0 license](https://it.wikipedia.org/wiki/Italian_Open_Data_License).
We'll start by downloading a copy with the English language column headers and
peek at the data in its original form.

```
$ curl -o all_prices.csv \
  -H 'Accept-Language: en-US' \
  'https://dgsaie.mise.gov.it/open_data_export.php?export-id=4&export-type=csv'

$ head -10 all_prices.csv
SURVEY_DATE,PRODUCT_ID,PRODUCT_NAME,PRICE,VAT,EXCISE,NET,CHANGE
2005-01-03,1,"Euro-Super 95",1115.75,185.96,558.64,371.15,-1.57
2005-01-03,2,"Automotive gas oil",1018.28,169.71,403.21,445.36,-0.33
2005-01-03,3,"Heating gas oil",948.5,158.08,403.21,387.21,-22.55
2005-01-03,5,LPG,552.5,92.08,156.62,303.8,0.22
2005-01-03,6,"Residual fuel oil",553.25,50.3,166.84,336.11,-12.21
2005-01-03,8,"Heavy fuel oil",229.52,0,31.39,198.13,-5.37
2005-01-10,1,"Euro-Super 95",1088,181.33,558.64,348.03,-27.75
2005-01-10,2,"Automotive gas oil",1004.39,167.4,403.21,433.78,-13.89
2005-01-10,3,"Heating gas oil",947.94,157.99,403.21,386.74,-0.56
```

Per the approach, we see that the date stamp is repeated for the measurement of
each of the six different fuel types. Also, being CSV data, this date field
begins life as a mere string and therefore must be transformed to the Zed
`time` type as we store it in the lake.

Taking this into account, we'll perform some preprocessing with
[`zq`](https://zed.brimdata.io/docs/commands/zq) to prepare the Time
Field and also isolate a subset of other fields, then ultimately load the data
into a pool in our Zed lake. For convenience, we'll use `ts` as the name of
the transformed time field since this is the plugin's default.

```
$ zed create prices1
pool created: prices1 2KkHUfmYz7FDdix6WRf7XEjkRfO

$ zq 'cut ts:=time(SURVEY_DATE),PRODUCT_NAME,PRICE' all_prices.csv \
  | zed -use prices1 load -
(2/1) 75.95KB 75.95KB/s
2KkHZEIfCdlCQJcgO9TAGT8cNpz committed
```

Reading back a sampling of our data, we can see the successful transform.

```
$ zed query -Z 'from prices1 | sample'
{
    ts: 2023-01-16T00:00:00Z,
    PRODUCT_NAME: "Automotive gas oil",
    PRICE: 1863.68
}
```

To plot the data for all six fuel types in the same panel, we can construct
six queries, each of which filters by category. Since the legend would
otherwise show "PRICE" for all six, we'll use Zed's
[`rename` operator](https://zed.brimdata.io/docs/language/operators/rename)  to
assign a unique field name for each before the data is handed off to Grafana.
Because we want to construct field names with spaces, we use
[field dereferencing with indexing](https://zed.brimdata.io/docs/language/overview#75-field-dereference).

Below is an example of one of the six queries, followed by the completed panel
shown in Grafana.

```
PRODUCT_NAME=="Automotive gas oil" | rename this["Automotive gas oil"]:=PRICE
```

![Example with one row per metric](https://github.com/brimdata/grafana-zed-datasource/raw/main/src/img/prices1.png)

### Each measurement (with lot of metrics) in its own row

If our data happens to be in the format with multiple metrics per row, it
becomes easy to plot with a single query. We can observe this by working with
the data in the
[weekly fuel prices](https://dgsaie.mise.gov.it/open_data_export.php?export-id=1&export-type=csv)
link at the same page we just used.

```
$ curl -o prices2.csv \
  -H 'Accept-Language: en-US' \
  'https://dgsaie.mise.gov.it/open_data_export.php?export-id=1&export-type=csv'

$ head -4 prices2.csv
SURVEY_DATE,EURO-SUPER_95,AUTOMOTIVE_GAS_OIL,LPG,HEATING_GAS_OIL,RESIDUAL_FUEL_OIL,HEAVY_FUEL_OIL
2005-01-03,1115.75,1018.28,552.5,948.5,553.25,229.52
2005-01-10,1088,1004.39,552.57,947.94,554.22,238.37
2005-01-17,1088.14,1004.31,551.88,952.42,562.78,245.89
```

As we see, there's now a separate column in the CSV file for each category of fuel
and each row of measurements appears with a single, shared date stamp. We'll
create another pool and once again transform the date stamp to a field of Zed's
`time` type as we load it into our lake.

```
$ zed create prices2
pool created: prices2 2KkJGc9sgl2T7eq5rB0WSff26IV

$ zq 'rename ts:=SURVEY_DATE | ts:=time(ts)' prices2.csv \
  | zed -use prices2 load -
(2/1) 30.29KB 30.29KB/s
2Kbf3eLGvItvbxLA2TMQyaCab2W committed

$ zed query -Z 'from prices2 | head 1'
{
    ts: 2023-01-16T00:00:00Z,
    "EURO-SUPER_95": 1813.58,
    AUTOMOTIVE_GAS_OIL: 1863.68,
    LPG: 799.71,
    HEATING_GAS_OIL: 1651.57,
    RESIDUAL_FUEL_OIL: 1120.82,
    HEAVY_FUEL_OIL: 636.78
}
```

Because Grafana defaults to plotting all numeric fields, all six appear on our
chart if we let the plugin use its default Zed query (`*`) that pulls all points
from the pool that are in the dashboard's current selected time range. The only
change from defaults we had to make when configuring our new panel was specifying
the pool name "prices2".

![Example with many metrics per row](https://github.com/brimdata/grafana-zed-datasource/raw/main/src/img/prices2.png)

If we wanted prettier names in the legend, we could add a Zed query to our
panel config such as:

```
rename this["Euro-Super 95"] := this["EURO-SUPER_95"],
       this["Automotive Gas Oil"] := this["AUTOMOTIVE_GAS_OIL"],
       this["Heating Gas Oil"] := this["HEATING_GAS_OIL"],
       this["Residual Fuel Oil"] := this["RESIDUAL_FUEL_OIL"],
       this["Heavy Fuel Oil"] := this["HEAVY_FUEL_OIL"]
```

### Transform between approaches

Now that we've seen the second approach makes it easier to plot, if you find
yourself with data that's already stored using the first approach, you could use
a Zed query like what's shown below to transform to the second approach. This
idiom could be used to preprocess the data before loading it into yet another
pool, or you could use it as part of a Zed query in your Grafana panel config.

```
$ zed query -Z 'from prices1
                | map(|{PRODUCT_NAME:PRICE}|) by ts
                | over map with time=ts => (
                  yield {key:[key],value}
                  | collect(this)
                  | unflatten(this)
                  | put ts:=time
                )'

{
    LPG: 799.71,
    "Euro-Super 95": 1813.58,
    "Heavy fuel oil": 636.78,
    "Heating gas oil": 1651.57,
    "Residual fuel oil": 1120.82,
    "Automotive gas oil": 1863.68,
    ts: 2023-01-16T00:00:00Z
}
...
```

In the future this functionality may be made available in more succinct Zed
syntax. Issue [zed/4332](https://github.com/brimdata/zed/issues/4332) tracks
this enhancement.

### Variables

The plugin does not yet support [query variables](https://grafana.com/docs/grafana/latest/developers/plugins/add-support-for-variables/#add-support-for-query-variables-to-your-data-source)
to populate [dashboard variables](https://grafana.com/docs/grafana/latest/dashboards/variables/)
with values pulled from a pool using Zed queries. However, in the meantime,
queries in panels can use variables made up of custom values defined in the
dashboard settings as long as the set of picked values can be expanded into
syntactically correct Zed.

Building on our prior example, here we've defined a multi-value variable called
"fuels" made up of the six categories of our data.

![Custom variable config](https://github.com/brimdata/grafana-zed-datasource/raw/main/src/img/custom-variable-config.png)

Returning to our dashboard, we now can enter a Zed query that uses the
[`cut` operator](https://zed.brimdata.io/docs/language/operators/cut) to
isolate only the Time Field and a variable reference that expands to a
comma-separated field list required by `cut`. Notice that we once again made
use of [field dereferencing with indexing](https://zed.brimdata.io/docs/language/overview#75-field-dereference)
for the field `EURO-SUPER_95` since it can't be referenced as an identifier due
to its name containing the character `-`.

![Custom variable in panel](https://github.com/brimdata/grafana-zed-datasource/raw/main/src/img/custom-variable-in-panel.png)

### Aggregations and the `$__interval` variable

The examples shown thus far assume that all points in the selected time range
should be plotted at their precise values. However, in practice, screen width
and/or volume of data may make this undesirable or impossible. In these
situations it's typical to [summarize](https://zed.brimdata.io/docs/language/operators/summarize)
time-bucketed sets of points into single values that can populate a smaller
number of pixels rendered in a chart. This summarization is done by applying
an [aggregate function](https://zed.brimdata.io/docs/language/aggregates) such
as [`avg()`](https://zed.brimdata.io/docs/language/aggregates/avg),
[`min()`](https://zed.brimdata.io/docs/language/aggregates/min),
[`max()`](https://zed.brimdata.io/docs/language/aggregates/max),
[`count()`](https://zed.brimdata.io/docs/language/aggregates/count), or
[`sum()`](https://zed.brimdata.io/docs/language/aggregates/sum) to each set of
raw points.

To illustrate this example, we'll use a data source of logged
[HTTP traffic](https://github.com/brimdata/zed-sample-data/blob/main/zeek-default/http.log.gz)
found in the [zed-sample-data repository](https://github.com/brimdata/zed-sample-data).
In our example we'll plot the count of [HTTP methods](https://www.rfc-editor.org/rfc/rfc7231#page-21)
in observed requests over time.

In the query we'll construct, the use of Grafana's built-in
[`$__interval`](https://grafana.com/docs/grafana/latest/dashboards/variables/add-template-variables/#__interval)
variable is essential. The value for this variable is changed automatically by
Grafana based on the current plot width and slides easily into the `span`
parameter of Zed's [`bucket()` function](https://zed.brimdata.io/docs/language/functions/bucket).

We'll once again start by creating a pool and loading our raw test data. Since
this data already has a `time`-typed Time Field called `ts`, we don't need to
perform the same preprocessing of the timestamp we did previously.

```
$ zed create http
pool created: http 2KkaG0Ms5mNM68kwXYbSj8tRciG

$ zq "get https://github.com/brimdata/zed-sample-data/blob/main/zeek-default/http.log.gz?raw=true" \
  | zed -use http load -
(1/1) 8.30MB 8.30MB/s
2KbzmcybYySkykAkYxTdYsNbL5o committed
```

Below is our example aggregation query, followed by the completed panel shown
in Grafana.

```
count() by ts:=bucket(ts,$__interval),method
| map(|{method:count}|) by ts
| over map with time=ts => (
  yield {key:[key],value}
  | collect(this)
  | unflatten(this)
  | put ts:=time
)
| fuse
```

![HTTP method count panel](https://github.com/brimdata/grafana-zed-datasource/raw/main/src/img/http-method-count.png)

To see the effect of the `$__interval` variable, open the Network tab of your
browser's Developer Tools and click the most recent request issued against the Zed
lake API's `query` endpoint. Here we can see the final query assembled by the
plugin based on the current panel settings. We can see that the `$__interval`
variable was replaced with a duration string `2s` that reflects 2-second time
buckets. If you zoom in/out to change the current time range for the plot and
check again, you'll see this value change.

![DevTools Network Tab](https://github.com/brimdata/grafana-zed-datasource/raw/main/src/img/devtools-network-tab.png)

To understand what the rest of the Zed is doing, let's look at a sample of
data from outside Grafana starting with just the aggregation.

```
$ zed query -z 'from http
                | count() by ts:=bucket(ts,2s),method
                | sort ts'

{ts:2018-03-24T17:15:20Z,method:"POST",count:1(uint64)}
{ts:2018-03-24T17:15:20Z,method:"OPTIONS",count:1(uint64)}
{ts:2018-03-24T17:15:20Z,method:"HEAD",count:1(uint64)}
{ts:2018-03-24T17:15:20Z,method:"PRI",count:1(uint64)}
{ts:2018-03-24T17:15:20Z,method:"PUT",count:1(uint64)}
{ts:2018-03-24T17:15:20Z,method:"GET",count:98(uint64)}
{ts:2018-03-24T17:15:22Z,method:null(string),count:1(uint64)}
{ts:2018-03-24T17:15:22Z,method:"POST",count:3(uint64)}
{ts:2018-03-24T17:15:22Z,method:"GET",count:84(uint64)}
...
```

Two things stand out here:

1. The timestamps are repeated in what's effectively the
   [one row per metric](#one-row-per-metric) approach discussed above. For
   this reason in the next several lines of Zed we reuse the
   [idiom shown previously](#transform-between-approaches) to transform
   to the approach that consolidates all metrics for a timestamp into the
   same row.

2. The HTTP methods vary per timestamp, which is different from what we
   saw with the fuel data where we always saw the same six fuel categories
   reported for every timestamp. For this reason we apply `fuse` at the
   end of our Zed to widen each record returned in the query response and
   add `null` values for methods that did not appear during a time interval.
   If we'd skipped the `fuse` we'd be attempting to plot multiple shapes and
   the plugin would kick back an error message (try it!)

Applying our full query and looking at a few lines of output, we can see the
effect.

```
$ zed query -Z 'from http
                | count() by ts:=bucket(ts,1s),method
                | map(|{method:count}|) by ts
                | over map with time=ts => (
                  yield {key:[key],value}
                  | collect(this)
                  | unflatten(this)
                  | put ts:=time
                )
                | fuse
                | sort ts'

{
    POST: 1 (uint64),
    ts: 2018-03-24T17:15:20Z,
    GET: 63 (uint64),
    HEAD: null (uint64),
...
```

You may notice lots of "dots" in the screenshot above, which are indicative of the
sparse appearance of rarely-used HTTP methods surrounded by many `null` points.
To consider options for representing such data, refer to Grafana's
documentation for the
[connect null values](https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/time-series/#connect-null-values)
setting.

### Annotations

Grafana's [annotations](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/annotate-visualizations/#querying-other-data-sources)
feature can be used to overlay details pulled from a Zed lake onto a
time-series plot.

As an example that builds on top of our plot of counted HTTP methods, the
following query creates a custom timestamped field called `msg` that populates
an annotation marking each time a user accessed the Google web site.

```
host=="www.google.com"
| yield {ts, msg: "client " + string(id.orig_h) + " accessed " + host}
```

![Configure annotation](https://github.com/brimdata/grafana-zed-datasource/raw/main/src/img/configure-annotation.png)

When we refresh our dashboard panel and hover the mouse pointer over the red
marker at the bottom of each dotted vertical line, we can see the custom
message.

![Hovering over annotation](https://github.com/brimdata/grafana-zed-datasource/raw/main/src/img/annotation-hover.png)

### Logs

Due to the previously-described limitations with only handling top-level
fields of primitive Zed types, the plugin is probably not well-suited for
general use with Grafana's
[Logs panel](https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/logs/).
However, the plugin is configured to permit this and you may find it useful
for examining string-based fields.

In this example we create a simple logs panel that shows the details of the
HTTP events for accessing the Google web site that we used as the basis for
our annotations query.

![Logs panel](https://github.com/brimdata/grafana-zed-datasource/raw/main/src/img/logs-panel.png)

## Debugging

When you hit problems, the first thing to check is for an alert shown
when you hover the mouse pointer over a red triangle in the upper-left corner
of a panel. The errors you may see here are described in this README and
should be self-explanatory.

![Hovering over an error message.](https://github.com/brimdata/grafana-zed-datasource/raw/main/src/img/error-hover.png)

If you can't make sense of the error message, you may find it helpful to look
in the Network tab of your browser's Developer Tools as shown
[above](#aggregations-and-the-__interval-variable). The assembled query shown
can then be executed outside of Grafana using `zed query` or in the Zui app to
narrow down if it's a problem with how the query is constructed or if it's a
bug/limitation in the plugin or Grafana.

If you're still stuck, come talk to us on the `#grafana` channel on the
[Brim Data community Slack](https://www.brimdata.io/join-slack/) or
[open an issue](https://github.com/brimdata/grafana-zed-datasource/issues).

## Why Unsigned?

Ideally we'd prefer to have the Zed plugin available in the
[public data source plugin directory](https://grafana.com/grafana/plugins/?type=datasource)
to make it easier to find and install. This is predicated on the plugin being
[signed](https://grafana.com/docs/grafana/latest/developers/plugins/sign-a-plugin/).
An initial release of the plugin was indeed submitted to the Grafana maintainers
with the belief it met the criteria for the "community"
[plugin signature level](https://grafana.com/docs/grafana/latest/developers/plugins/sign-a-plugin/#plugin-signature-levels)
since, per that page, the dependent [Zed](https://zed.brimdata.io/) technology 
is offered to the community free of charge as open source and will continue to be
indefinitely. However, after initial review of our submission we were pointed
at [more extensive legal terms](https://grafana.com/legal/plugins/)
which explain that to qualify for the community signature level the plugin must
be "not affiliated with any commercial endeavor". As the corporate sponsor of
the Zed project, [Brim Data](https://www.brimdata.io/) is currently a seed stage startup, and the company
does hope to one day operate a viable business such as by offering paid services and
support to users that may want it. Apparently this fact alone is enough to
disqualify the plugin from eligibility at the "community" level. Furthermore, the
constraints of being a seed stage startup mean Brim Data cannot currently
justify the expense of paying the quoted price to be signed at Grafana's
"commercial" signature level. While this is disappointing, we respect Grafana's
decision to run their programs as they wish. We are hopeful that they will
one day change their policies to benefit our combined user base. In the
meantime, we hope that users may benefit from using the Zed plugin even in
its atypical "unsigned" state.

If you have additional questions or concerns about running "unsigned", or if
you feel strongly about the plugin being "signed" and have thoughts on how
to move past the known barriers, please come talk to us in the `#grafana`
channel on the [Brim Data community Slack](https://www.brimdata.io/join-slack/).

## Contributing

Contributions are welcomed! Per common practice, please
[open an issue](https://github.com/brimdata/grafana-zed-datasource/issues)
before sending a pull request.  If you think your ideas might benefit from
some refinement via Q&A, come talk to us on the `#grafana` channel on the
[Brim Data community Slack](https://www.brimdata.io/join-slack/).

## Join the Community

Join the [Brim Data community Slack](https://www.brimdata.io/join-slack/) workspace for
announcements, Q&A, and to trade tips. There's a `#grafana` channel where you
can ask questions and get help with this plugin, a `#zed` channel for Q&A about the
Zed language & lake, and more!
