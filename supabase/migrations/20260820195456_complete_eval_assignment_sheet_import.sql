begin;

-- Complete the one-time Sheet cutover from the 9,857-row ALL IN ONE source.
-- The August 20 extract stopped at row 6,000, leaving the latter assignees
-- and 1,168 current Drive ItemCode + GenusName keys without assignments.
-- A manual Dylan/Megan assignment remains authoritative over this backfill.

with source_rows as (
  select
    upper(btrim(x.itemcode)) as itemcode_normalized,
    btrim(x.genusname) as genusname,
    lower(regexp_replace(btrim(x.genusname), '[[:space:]]+', ' ', 'g')) as genusname_normalized,
    lower(btrim(x.assignedto)) as assignedto,
    private.normalize_eval_assignment_key(x.itemcode, x.genusname) as assignment_key
  from jsonb_to_recordset($assignment_rows$
[
  {
    "itemcode": "005255.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004638.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004636.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005248.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007122.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004637.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001590.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001591.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001595.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001596.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011030.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001598.081.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001599.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001603.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001605.081.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001605.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001606.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008357.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005678.081.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005678.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001611.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010286.031.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001193.030.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001196.030.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005770.030.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001191.030.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001198.010.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001198.030.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010836.010.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001320.030.1",
    "genusname": "az Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003131.011.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003131.021.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003131.051.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003190.011.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003190.021.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003190.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003190.051.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002940.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002940.020.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002940.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002940.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002945.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002945.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002945.100.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002960.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002960.020.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002960.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002960.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002965.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002965.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002980.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002980.020.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002980.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002980.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002985.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002985.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002985.100.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003000.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003000.020.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003000.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003000.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003005.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003005.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003005.100.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011182.021.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002031.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002031.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002031.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002982.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "009401.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "009401.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "009401.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010707.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010707.070.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003567.081.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003567.021.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003567.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007362.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003055.020.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003055.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003055.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003048.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003048.100.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008564.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008564.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008564.071.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011500.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008565.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008565.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008686.008.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008686.021.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008686.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008686.051.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008686.071.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010514.008.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010514.081.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010514.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010514.021.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010514.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010514.071.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011075.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011075.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005509.011.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005509.021.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005509.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005509.051.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005509.070.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006105.051.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006105.100.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006611.011.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006611.021.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006611.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006611.051.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005510.011.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005510.021.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005510.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005510.051.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006106.051.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006106.070.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006106.100.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005511.011.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005511.021.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005511.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005511.051.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006107.051.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005624.011.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005624.021.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005624.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005624.051.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006108.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006108.050.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006108.051.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010694.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010694.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004665.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004665.021.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004665.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008038.010.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008038.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008038.071.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006885.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006883.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007735.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006884.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001961.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "000998.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008415.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002040.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008874.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008876.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008925.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008873.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011342.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011603.031.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010331.030.1",
    "genusname": "Hibiscus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001850.010.1",
    "genusname": "Cotoneaster",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001850.020.1",
    "genusname": "Cotoneaster",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001850.030.1",
    "genusname": "Cotoneaster",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001860.030.1",
    "genusname": "Cotoneaster",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011497.031.1",
    "genusname": "Cotoneaster",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001900.030.1",
    "genusname": "Cotoneaster",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001940.030.1",
    "genusname": "Cotoneaster",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003164.011.1",
    "genusname": "Cotoneaster",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003164.031.1",
    "genusname": "Cotoneaster",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "000744.010.1",
    "genusname": "Cotoneaster",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "000744.030.1",
    "genusname": "Cotoneaster",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007068.021.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008910.030.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008910.050.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008910.070.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008910.150.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008910.250.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010827.050.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010827.070.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010827.150.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010827.250.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011513.031.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008568.031.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008568.070.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010191.030.1",
    "genusname": "Vitex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001763.050.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011786.051.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006139.031.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001696.070.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004834.031.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006610.031.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001503.011.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001503.021.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001503.031.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001503.051.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001503.070.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001697.030.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001697.050.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005668.031.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005668.051.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002324.030.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002324.050.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011262.021.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011262.031.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001780.010.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001780.020.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001780.030.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001886.030.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004664.031.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004664.051.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "009361.081.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "009361.021.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "009361.031.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001530.010.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001530.030.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001530.050.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001535.081.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001535.021.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001535.031.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008647.021.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008647.031.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005830.011.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005830.021.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005830.031.1",
    "genusname": "Itea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006613.021.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006613.031.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008652.021.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008652.031.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006580.011.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006580.021.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006580.031.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006580.051.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011195.021.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006540.010.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006540.020.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006540.030.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006545.010.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006545.020.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006545.030.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006545.050.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006590.030.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006590.150.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011511.031.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004656.081.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004656.010.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004656.031.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007779.081.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007779.010.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007779.021.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007779.031.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010689.021.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010689.031.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008297.010.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008297.031.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004643.081.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "004643.031.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010677.010.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010677.031.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010676.031.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006548.010.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006548.020.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006548.030.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006548.050.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006535.010.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006535.020.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006535.030.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006535.050.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010346.021.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008394.021.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008393.021.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010988.021.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005282.011.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005282.021.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005282.031.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005282.070.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006555.010.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006555.030.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006555.050.1",
    "genusname": "Spiraea",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008872.031.1",
    "genusname": "Sorbaria",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "009463.031.1",
    "genusname": "Sorbaria",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002212.030.1",
    "genusname": "Rhaphiolepis",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007737.030.1",
    "genusname": "Rhaphiolepis",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002135.030.1",
    "genusname": "Rhaphiolepis",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005525.030.1",
    "genusname": "Rhaphiolepis",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010353.030.1",
    "genusname": "Rhaphiolepis",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011264.031.1",
    "genusname": "Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011263.031.1",
    "genusname": "Rhododendron",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011683.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011664.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011667.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011847.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011666.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011665.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008019.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008019.031.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008019.051.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008019.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008019.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008019.250.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010705.050.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010705.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010705.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007373.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007373.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007374.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007374.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007375.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007375.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005834.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005834.031.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005834.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005835.031.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003935.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003935.050.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003935.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003935.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003935.250.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003937.050.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003937.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003937.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008017.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008017.031.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008017.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008017.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008363.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008363.031.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008363.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008363.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011858.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011157.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011157.031.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011157.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007131.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007131.031.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007131.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007131.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007131.250.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011857.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008011.050.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008013.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008013.031.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008013.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008013.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008015.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008015.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003975.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003975.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007673.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007673.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003751.010.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003751.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003751.050.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003751.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003751.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003751.250.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003757.010.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003757.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003757.050.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003757.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003757.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003757.250.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003754.010.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003754.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003754.050.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003754.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003754.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002112.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002112.050.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002112.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "002112.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "000925.030.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "000925.050.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "000925.070.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "000925.150.1",
    "genusname": "Lagerstroemia (Large)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003746.030.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003746.050.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005686.010.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005686.030.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005686.050.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005686.070.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005686.150.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003748.010.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003748.030.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003748.050.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003748.070.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003970.010.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003970.030.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003970.050.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003970.070.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003970.150.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001701.030.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003989.030.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003989.050.1",
    "genusname": "Lagerstroemia (Medium)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006584.031.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006111.011.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006111.031.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006112.011.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006112.031.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "006113.031.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003840.010.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003840.020.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003840.030.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005245.031.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005243.031.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005242.031.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "005244.031.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003820.030.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003820.050.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003780.030.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003780.050.1",
    "genusname": "Lagerstroemia (Small)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003773.020.1",
    "genusname": "Lagerstroemia (Weeping)",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008872.021.1",
    "genusname": "Sorbaria",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010288.021.1",
    "genusname": "Gardenia",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "011863.010.1",
    "genusname": "Gardenia",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "001763.030.1",
    "genusname": "Cornus",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "008999.031.1",
    "genusname": "Ilex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "007842.031.1",
    "genusname": "Ilex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003614.010.1",
    "genusname": "Ilex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003614.020.1",
    "genusname": "Ilex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003614.030.1",
    "genusname": "Ilex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "003614.070.1",
    "genusname": "Ilex",
    "assignedto": "charley_robertson"
  },
  {
    "itemcode": "010225.010.1",
    "genusname": "Buddleia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010224.010.1",
    "genusname": "Buddleia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010226.010.1",
    "genusname": "Buddleia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010223.010.1",
    "genusname": "Buddleia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010222.010.1",
    "genusname": "Buddleia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011103.020.1",
    "genusname": "Clematis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011093.020.1",
    "genusname": "Clematis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011104.020.1",
    "genusname": "Clematis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "003471.013.1",
    "genusname": "Clematis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002167.013.1",
    "genusname": "Clematis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006324.013.1",
    "genusname": "Clematis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010750.020.1",
    "genusname": "Clematis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007657.021.1",
    "genusname": "Rosmarinus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005656.013.1",
    "genusname": "Rosmarinus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005656.020.1",
    "genusname": "Rosmarinus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001323.020.1",
    "genusname": "Rosmarinus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005651.020.1",
    "genusname": "Rosmarinus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005212.008.1",
    "genusname": "Rosmarinus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005652.008.1",
    "genusname": "Rosmarinus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005652.020.1",
    "genusname": "Rosmarinus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006447.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006940.007.1",
    "genusname": "Vinca",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005950.011.1",
    "genusname": "Carex",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002714.007.1",
    "genusname": "Festuca",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011839.010.1",
    "genusname": "Panicum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004732.013.1",
    "genusname": "Pennisetum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004732.030.1",
    "genusname": "Pennisetum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004726.007.1",
    "genusname": "Pennisetum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002497.020.1",
    "genusname": "Pennisetum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008030.020.1",
    "genusname": "Pennisetum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011524.020.1",
    "genusname": "Pennisetum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004730.010.1",
    "genusname": "Pennisetum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "003117.010.1",
    "genusname": "Pteris",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002090.010.1",
    "genusname": "Thelypteris",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005141.055.1",
    "genusname": "Mix",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002528.007.1",
    "genusname": "Alternanthera",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002272.030.1",
    "genusname": "Crossandra",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007936.007.1",
    "genusname": "Dichondra",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001828.013.1",
    "genusname": "Euryops",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009695.013.1",
    "genusname": "Hypoestes",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002494.013.1",
    "genusname": "Hypoestes",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004018.013.1",
    "genusname": "Lantana",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007950.013.1",
    "genusname": "Portulaca",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006577.013.1",
    "genusname": "Portulaca",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001058.013.1",
    "genusname": "Scirpus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009704.007.1",
    "genusname": "Tradescantia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009410.013.1",
    "genusname": "Achillea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009504.013.1",
    "genusname": "Achillea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002455.013.1",
    "genusname": "Achillea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009512.013.1",
    "genusname": "Achillea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001077.013.1",
    "genusname": "Agastache",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002417.013.1",
    "genusname": "Ajuga",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002258.013.1",
    "genusname": "Ajuga",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002255.013.1",
    "genusname": "Ajuga",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011426.013.1",
    "genusname": "Alcea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009044.013.1",
    "genusname": "Artemisia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009352.013.1",
    "genusname": "Artemisia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007825.013.1",
    "genusname": "Aster",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007827.013.1",
    "genusname": "Aster",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007826.013.1",
    "genusname": "Aster",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007828.013.1",
    "genusname": "Aster",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009153.013.1",
    "genusname": "Campanula",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009357.013.1",
    "genusname": "Ceratostigma",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011845.013.1",
    "genusname": "Chrysactinia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008354.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008354.030.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011577.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006851.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005733.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008484.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007752.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010130.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007753.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011381.081.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011382.081.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001790.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011401.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009351.007.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009351.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008943.013.1",
    "genusname": "Delosperma",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "003358.013.1",
    "genusname": "Delosperma",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009182.007.1",
    "genusname": "Dianthus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011081.013.1",
    "genusname": "Dianthus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010292.013.1",
    "genusname": "Dianthus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009363.013.1",
    "genusname": "Dianthus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009574.013.1",
    "genusname": "Dianthus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011200.021.1",
    "genusname": "Dianthus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "000429.007.1",
    "genusname": "Dianthus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011548.007.1",
    "genusname": "Dianthus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007907.007.1",
    "genusname": "Dianthus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001918.013.1",
    "genusname": "Dianthus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011404.013.1",
    "genusname": "Dianthus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011405.013.1",
    "genusname": "Dianthus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011414.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011102.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011086.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009314.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004964.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005010.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009199.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007563.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005787.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005437.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011807.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009722.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009721.013.1",
    "genusname": "Echinacea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001362.013.1",
    "genusname": "Eupatorium",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011221.013.1",
    "genusname": "Eupatorium",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011221.020.1",
    "genusname": "Eupatorium",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010117.013.1",
    "genusname": "Gaillardia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007947.013.1",
    "genusname": "Gaillardia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007328.013.1",
    "genusname": "Gaura",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002274.013.1",
    "genusname": "Gaura",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011323.013.1",
    "genusname": "Heliopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010384.013.1",
    "genusname": "Heliopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002891.007.1",
    "genusname": "Hemerocallis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005994.013.1",
    "genusname": "Heuchera",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011439.013.1",
    "genusname": "Heuchera",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007880.013.1",
    "genusname": "Heuchera",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011429.013.1",
    "genusname": "Heucherella",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005050.021.1",
    "genusname": "Hosta",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011762.021.1",
    "genusname": "Hosta",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011761.021.1",
    "genusname": "Hosta",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "000886.010.1",
    "genusname": "Hosta",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009499.013.1",
    "genusname": "Lavandula",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006059.013.1",
    "genusname": "Lavandula",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010368.020.1",
    "genusname": "Lavandula",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009229.013.1",
    "genusname": "Leucanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "000422.013.1",
    "genusname": "Leucanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009501.013.1",
    "genusname": "Lobelia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010415.013.1",
    "genusname": "Lobelia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009522.007.1",
    "genusname": "Lysimachia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009522.013.1",
    "genusname": "Lysimachia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009523.007.1",
    "genusname": "Lysimachia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009523.013.1",
    "genusname": "Lysimachia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004441.013.1",
    "genusname": "Malvaviscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001975.013.1",
    "genusname": "Melampodium",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011789.013.1",
    "genusname": "Monarda",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007755.013.1",
    "genusname": "Monarda",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009298.013.1",
    "genusname": "Monarda",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009576.013.1",
    "genusname": "Monarda",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008982.013.1",
    "genusname": "Monarda",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009544.013.1",
    "genusname": "Monarda",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005777.013.1",
    "genusname": "Nepeta",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009577.013.1",
    "genusname": "Nepeta",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "000419.013.1",
    "genusname": "Nepeta",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010118.013.1",
    "genusname": "Nepeta",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010581.013.1",
    "genusname": "Nepeta",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007545.013.1",
    "genusname": "Penstemon",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009412.013.1",
    "genusname": "Penstemon",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011218.020.1",
    "genusname": "Penstemon",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008048.013.1",
    "genusname": "Penstemon",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009364.013.1",
    "genusname": "Perovskia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "000421.013.1",
    "genusname": "Perovskia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002705.013.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007795.013.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005349.013.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007492.013.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011051.007.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004798.007.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004800.007.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004802.007.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011470.081.1",
    "genusname": "Pulmonaria",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009297.013.1",
    "genusname": "Rudbeckia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008185.013.1",
    "genusname": "Rudbeckia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008514.013.1",
    "genusname": "Rudbeckia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009035.013.1",
    "genusname": "Rudbeckia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009035.030.1",
    "genusname": "Rudbeckia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009625.007.1",
    "genusname": "Sagina",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002185.007.1",
    "genusname": "Sagina",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002185.013.1",
    "genusname": "Sagina",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001295.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001295.030.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009254.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001248.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002101.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011407.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008264.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007074.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007074.020.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007074.030.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "000462.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007623.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010412.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011199.021.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008099.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008485.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008485.030.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008976.013.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008976.030.1",
    "genusname": "Salvia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009509.013.1",
    "genusname": "Scabiosa",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009510.013.1",
    "genusname": "Scabiosa",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001921.013.1",
    "genusname": "Solidago",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009609.013.1",
    "genusname": "Solidago",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009491.013.1",
    "genusname": "Stachys",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008527.013.1",
    "genusname": "Stachys",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009307.013.1",
    "genusname": "Verbena",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008053.013.1",
    "genusname": "Veronica",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001067.007.1",
    "genusname": "Veronica",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010395.013.1",
    "genusname": "Veronica",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "000444.013.1",
    "genusname": "Veronica",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011518.013.1",
    "genusname": "Veronica",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005932.007.1",
    "genusname": "Veronica",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010067.013.1",
    "genusname": "Veronica",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005957.022.1",
    "genusname": "Mix",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005957.055.1",
    "genusname": "Mix",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004534.007.1",
    "genusname": "Aloe",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005587.007.1",
    "genusname": "Echeveria",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001501.007.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001501.013.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "000441.013.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009301.013.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002419.013.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008516.007.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "003374.007.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "003374.013.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007561.013.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006864.007.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006864.013.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006861.013.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006862.007.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006862.013.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010132.013.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010132.022.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008969.013.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009580.013.1",
    "genusname": "Sedum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010413.013.1",
    "genusname": "Sempervivum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007477.007.1",
    "genusname": "Sempervivum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002632.007.1",
    "genusname": "Sempervivum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002632.013.1",
    "genusname": "Sempervivum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006353.030.1",
    "genusname": "Hamelia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007453.008.1",
    "genusname": "Cupressus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007453.030.1",
    "genusname": "Cupressus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004287.007.1",
    "genusname": "Allium",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010401.007.1",
    "genusname": "Mentha",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007073.007.1",
    "genusname": "Ocimum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004292.007.1",
    "genusname": "Origanum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004293.007.1",
    "genusname": "Petroselinum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004329.007.1",
    "genusname": "Petroselinum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008946.031.1",
    "genusname": "Ficus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011538.022.1",
    "genusname": "Asparagus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001668.030.1",
    "genusname": "Buddleia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007115.008.1",
    "genusname": "Olea",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009547.008.1",
    "genusname": "Serissa",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011324.008.1",
    "genusname": "Serissa",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007160.020.1",
    "genusname": "Yucca",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011475.013.1",
    "genusname": "Angelonia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011474.013.1",
    "genusname": "Angelonia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009459.013.1",
    "genusname": "Coleus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007936.013.1",
    "genusname": "Dichondra",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002415.013.1",
    "genusname": "Duranta",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006551.013.1",
    "genusname": "Petunia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006577.022.1",
    "genusname": "Portulaca",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009368.013.1",
    "genusname": "Portulaca",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011412.013.1",
    "genusname": "Digitalis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011417.013.1",
    "genusname": "Rudbeckia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011420.013.1",
    "genusname": "Rudbeckia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011373.081.1",
    "genusname": "Vernonia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011528.020.1",
    "genusname": "Agave",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011130.020.1",
    "genusname": "Agave",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010561.020.1",
    "genusname": "Agave",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011527.020.1",
    "genusname": "Agave",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009468.020.1",
    "genusname": "Agave",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011529.020.1",
    "genusname": "Agave",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004534.020.1",
    "genusname": "Aloe",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011590.020.1",
    "genusname": "Aloe",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011576.022.1",
    "genusname": "Aptenia",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011150.021.1",
    "genusname": "Mangave",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010728.020.1",
    "genusname": "Mangave",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011092.020.1",
    "genusname": "Mangave",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010968.020.1",
    "genusname": "Mangave",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010792.021.1",
    "genusname": "Mangave",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011606.020.1",
    "genusname": "Yucca",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009333.030.1",
    "genusname": "Clerodendrum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010337.081.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010337.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010337.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010331.081.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010331.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010331.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010333.081.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010333.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010333.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010335.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010335.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010334.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010334.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010336.081.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010336.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010336.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010338.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010332.081.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010332.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010332.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011330.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010667.081.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010667.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010667.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006674.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006674.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002917.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002917.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006670.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006670.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006673.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006671.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006671.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006091.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006091.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006094.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "000193.021.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "000193.031.1",
    "genusname": "Hibiscus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008422.030.1",
    "genusname": "Mandevilla",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008420.030.1",
    "genusname": "Mandevilla",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011126.030.1",
    "genusname": "Mandevilla",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010905.030.1",
    "genusname": "Mandevilla",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011042.030.1",
    "genusname": "Mandevilla",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001872.030.1",
    "genusname": "Mandevilla",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010883.030.1",
    "genusname": "Musa",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008891.022.1",
    "genusname": "Lycopersicon",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "000798.021.1",
    "genusname": "Citrofortunella",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005020.021.1",
    "genusname": "Citrus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008215.081.1",
    "genusname": "Citrus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008218.021.1",
    "genusname": "Citrus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "005022.081.1",
    "genusname": "Citrus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "008946.021.1",
    "genusname": "Ficus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011534.013.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011467.081.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010003.013.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004798.010.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004800.010.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "004802.010.1",
    "genusname": "Phlox",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006997.031.1",
    "genusname": "Syringa",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011632.013.1",
    "genusname": "Agastache",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011627.013.1",
    "genusname": "Epilobium",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011631.013.1",
    "genusname": "Penstemon",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011635.013.1",
    "genusname": "Penstemon",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011625.013.1",
    "genusname": "Penstemon",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011623.013.1",
    "genusname": "Psephellus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011623.020.1",
    "genusname": "Psephellus",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011609.021.1",
    "genusname": "Silene",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011369.020.1",
    "genusname": "Stachys",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011630.013.1",
    "genusname": "Teucrium",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011326.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010764.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007419.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007817.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011089.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011089.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007664.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007664.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010097.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "010097.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011316.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011316.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011317.083.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011317.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011317.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011317.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011318.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011318.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011085.083.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011085.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011085.022.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011085.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006578.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006578.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006578.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011319.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011319.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011319.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011320.083.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011320.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011320.022.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011320.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011320.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011321.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011322.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002045.083.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002045.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002045.022.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002045.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "002045.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007964.083.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007964.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007964.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007964.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006583.083.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006583.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006583.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006583.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011314.083.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011314.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011314.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011314.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011315.083.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011315.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011315.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "011315.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009714.083.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009714.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009714.022.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009714.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009714.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007963.083.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007963.019.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007963.033.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007963.055.1",
    "genusname": "Chrysanthemum",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "009176.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "006961.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "007831.013.1",
    "genusname": "Coreopsis",
    "assignedto": "zoe_green"
  },
  {
    "itemcode": "001083.010.1",
    "genusname": "Acorus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "000912.010.1",
    "genusname": "Andropogon",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "000912.030.1",
    "genusname": "Andropogon",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "007539.031.1",
    "genusname": "Andropogon",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011566.010.1",
    "genusname": "Bouteloua",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006192.010.1",
    "genusname": "Bouteloua",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006755.010.1",
    "genusname": "Bouteloua",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008068.030.1",
    "genusname": "Calamagrostis",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004733.010.1",
    "genusname": "Calamagrostis",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004733.020.1",
    "genusname": "Calamagrostis",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004733.030.1",
    "genusname": "Calamagrostis",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011057.010.1",
    "genusname": "Carex",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011132.010.1",
    "genusname": "Carex",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008486.010.1",
    "genusname": "Carex",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "000370.010.1",
    "genusname": "Chasmanthium",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "000370.030.1",
    "genusname": "Chasmanthium",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "007541.031.1",
    "genusname": "Cortaderia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "007541.051.1",
    "genusname": "Cortaderia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004148.010.1",
    "genusname": "Cortaderia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004148.021.1",
    "genusname": "Cortaderia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004148.031.1",
    "genusname": "Cortaderia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004148.051.1",
    "genusname": "Cortaderia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001800.030.1",
    "genusname": "Cortaderia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008523.011.1",
    "genusname": "Festuca",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002714.010.1",
    "genusname": "Festuca",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004104.010.1",
    "genusname": "Juncus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004104.030.1",
    "genusname": "Juncus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004103.010.1",
    "genusname": "Juncus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004103.020.1",
    "genusname": "Juncus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004508.010.1",
    "genusname": "Leymus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004508.030.1",
    "genusname": "Leymus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004350.010.1",
    "genusname": "Liriope",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "005693.011.1",
    "genusname": "Liriope",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004380.010.1",
    "genusname": "Liriope",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004500.010.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004500.020.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004500.030.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "007836.030.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004502.010.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004502.020.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004502.030.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004501.010.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004501.030.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004510.010.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004510.030.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001404.010.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001404.020.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001404.030.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001110.010.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001110.020.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001110.030.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004450.010.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004450.020.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004450.030.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004450.050.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004486.010.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004457.020.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004457.030.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004479.010.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004479.030.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004455.030.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004489.010.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004489.020.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004489.030.1",
    "genusname": "Miscanthus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004254.030.1",
    "genusname": "Muhlenbergia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "007807.030.1",
    "genusname": "Muhlenbergia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010539.010.1",
    "genusname": "Muhlenbergia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010539.030.1",
    "genusname": "Muhlenbergia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004419.010.1",
    "genusname": "Nassella",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004419.020.1",
    "genusname": "Nassella",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004700.010.1",
    "genusname": "Ophiopogon",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "000748.010.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "000748.030.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011215.030.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004496.010.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004496.020.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004496.030.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "007881.030.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001973.010.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001973.020.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001973.030.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001973.050.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004424.010.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004424.020.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004424.030.1",
    "genusname": "Panicum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008046.010.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008046.030.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004729.020.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004729.030.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011067.010.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011067.030.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004726.010.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004726.020.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004726.030.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008631.010.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008631.030.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008344.031.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004737.010.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004737.030.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004730.020.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004730.030.1",
    "genusname": "Pennisetum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002210.010.1",
    "genusname": "Saccharum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002210.020.1",
    "genusname": "Saccharum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002210.030.1",
    "genusname": "Saccharum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002210.050.1",
    "genusname": "Saccharum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008533.010.1",
    "genusname": "Schizachyrium",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008533.021.1",
    "genusname": "Schizachyrium",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008521.011.1",
    "genusname": "Schizachyrium",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011077.010.1",
    "genusname": "Schizachyrium",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011077.020.1",
    "genusname": "Schizachyrium",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "003521.010.1",
    "genusname": "Schizachyrium",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "003521.020.1",
    "genusname": "Schizachyrium",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "003521.030.1",
    "genusname": "Schizachyrium",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004743.010.1",
    "genusname": "Schizachyrium",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011557.030.1",
    "genusname": "Sorghastrum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001360.010.1",
    "genusname": "Sporobolus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001360.030.1",
    "genusname": "Sporobolus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011216.010.1",
    "genusname": "Sporobolus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011216.030.1",
    "genusname": "Sporobolus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011280.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004853.011.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004853.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004853.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010348.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004227.011.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004227.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004227.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010347.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "009054.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "009317.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "007409.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001672.010.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001672.020.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001672.030.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010059.030.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010790.030.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010053.030.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011198.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011197.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011196.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002027.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001666.010.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001666.020.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001666.030.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001667.010.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001667.020.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001667.030.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001668.010.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001668.020.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001669.010.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001669.020.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001669.030.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001670.030.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006895.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011378.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "005102.081.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "005102.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008563.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008563.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "005104.081.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "005104.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "005104.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "007887.081.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "007887.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "007887.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004819.030.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008125.081.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008125.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008125.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008034.081.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008034.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008034.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008035.081.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008035.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008035.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011377.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "009341.081.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "009341.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011376.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008148.081.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008148.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008148.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004229.011.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004229.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004229.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006116.021.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006116.031.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001686.030.1",
    "genusname": "Buddleia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006009.081.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006009.010.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006009.021.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006009.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006009.051.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006009.071.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011491.021.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011491.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008377.021.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010620.021.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010620.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010802.051.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011026.021.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011026.070.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "000749.010.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "000749.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "000749.051.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "000749.071.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001332.051.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001332.071.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008737.010.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008737.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008737.051.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "008737.071.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010801.050.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010801.071.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "009003.010.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "009003.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010706.050.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004207.081.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004207.010.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004207.021.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004207.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "004207.051.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "007320.050.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006408.081.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006408.010.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006408.021.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006408.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006408.051.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "009373.010.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "009373.021.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "009373.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010513.010.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010513.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011071.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010170.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002208.010.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002208.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002208.051.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002208.071.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "003202.050.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "003202.051.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "003202.071.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "003202.100.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "009005.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011492.010.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011492.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006737.010.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006737.021.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006737.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006737.070.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010934.100.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010771.010.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010771.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010907.050.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006117.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006174.051.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010248.021.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "010248.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "009729.021.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "005187.021.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "005187.031.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "005187.070.1",
    "genusname": "Hydrangea p.",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002655.030.1",
    "genusname": "Hypericum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006489.021.1",
    "genusname": "Hypericum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006489.031.1",
    "genusname": "Hypericum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "000751.030.1",
    "genusname": "Hypericum",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001337.081.1",
    "genusname": "Deutzia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001337.031.1",
    "genusname": "Deutzia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002081.010.1",
    "genusname": "Deutzia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002081.020.1",
    "genusname": "Deutzia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "002081.030.1",
    "genusname": "Deutzia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011498.031.1",
    "genusname": "Deutzia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011016.031.1",
    "genusname": "Deutzia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "005759.081.1",
    "genusname": "Deutzia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "005759.031.1",
    "genusname": "Deutzia",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006794.031.1",
    "genusname": "Sambucus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011851.031.1",
    "genusname": "Sambucus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "011852.031.1",
    "genusname": "Sambucus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "006612.031.1",
    "genusname": "Sambucus",
    "assignedto": "dylan_collyge"
  },
  {
    "itemcode": "001183.050.1",
    "genusname": "Cedrus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "001183.150.1",
    "genusname": "Cedrus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003796.030.1",
    "genusname": "Cedrus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002227.010.1",
    "genusname": "Cephalotaxus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002227.030.1",
    "genusname": "Cephalotaxus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002776.010.1",
    "genusname": "Cephalotaxus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002776.030.1",
    "genusname": "Cephalotaxus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002113.030.1",
    "genusname": "Chamaecyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000101.010.1",
    "genusname": "Chamaecyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000101.020.1",
    "genusname": "Chamaecyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000101.030.1",
    "genusname": "Chamaecyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000101.050.1",
    "genusname": "Chamaecyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000101.070.1",
    "genusname": "Chamaecyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003068.010.1",
    "genusname": "Chamaecyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003068.020.1",
    "genusname": "Chamaecyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003068.030.1",
    "genusname": "Chamaecyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003068.070.1",
    "genusname": "Chamaecyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010640.030.1",
    "genusname": "Cryptomeria",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010640.070.1",
    "genusname": "Cryptomeria",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002491.030.1",
    "genusname": "Cupressocyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "006916.030.1",
    "genusname": "Cupressocyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "006916.070.1",
    "genusname": "Cupressocyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "006916.150.1",
    "genusname": "Cupressocyparis",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "001565.008.1",
    "genusname": "Cupressus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "001565.030.1",
    "genusname": "Cupressus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005452.070.1",
    "genusname": "Cupressus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009246.030.1",
    "genusname": "Cupressus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009246.250.1",
    "genusname": "Cupressus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011055.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011055.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000150.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000150.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000150.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000150.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000150.150.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000150.150.2",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000152.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000152.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000156.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008317.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000151.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000151.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000154.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000154.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000154.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000154.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000154.150.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004593.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000635.010.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000635.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000635.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000635.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000180.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000180.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000180.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000180.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000180.070.2",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000180.150.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000185.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000185.150.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000191.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000191.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000340.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000340.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000340.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000340.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000260.010.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000260.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000260.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000260.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000260.050.2",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011729.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000571.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000571.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000571.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000571.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000571.150.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003549.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003549.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003549.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003549.050.2",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003549.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000300.010.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000300.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000300.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000300.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000636.010.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000636.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000636.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000636.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011730.020.1",
    "genusname": "Juncus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000310.010.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000310.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000310.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000310.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000310.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011266.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011266.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010809.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010809.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003645.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003645.150.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004592.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000360.010.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000360.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000360.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011731.020.1",
    "genusname": "Juncus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004832.011.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004832.021.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004832.031.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000470.010.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000470.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000470.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000470.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000450.010.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000450.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000450.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000450.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000550.010.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000550.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000550.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000550.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000575.010.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000575.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000575.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000577.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000577.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000580.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000580.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011856.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011855.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009477.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009477.031.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009477.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003194.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003194.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003194.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003194.150.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003647.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003647.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003647.030.2",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003647.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003647.050.2",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003647.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003647.150.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002355.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009402.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009402.021.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009402.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009402.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005670.011.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005670.021.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005670.031.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005670.051.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011859.050.1",
    "genusname": "Juncus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011860.050.1",
    "genusname": "Juncus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011732.021.1",
    "genusname": "Juncus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000720.010.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000720.020.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000720.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000720.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000720.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011861.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003338.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000710.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000745.008.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000745.030.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000745.050.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000745.050.2",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000745.070.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000745.070.2",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000745.150.1",
    "genusname": "Juniperus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011115.050.1",
    "genusname": "Picea",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "006891.070.1",
    "genusname": "Picea",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002788.030.1",
    "genusname": "Picea",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004563.050.1",
    "genusname": "Picea",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004563.070.1",
    "genusname": "Picea",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004563.100.1",
    "genusname": "Picea",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000759.030.1",
    "genusname": "Pinus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000759.050.1",
    "genusname": "Pinus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000760.050.1",
    "genusname": "Pinus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010778.070.1",
    "genusname": "Pinus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000764.030.1",
    "genusname": "Pinus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000772.030.1",
    "genusname": "Pinus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000772.050.1",
    "genusname": "Pinus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000772.070.1",
    "genusname": "Pinus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008293.030.1",
    "genusname": "Platycladus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000777.010.1",
    "genusname": "Taxus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000777.020.1",
    "genusname": "Taxus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000777.030.1",
    "genusname": "Taxus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000777.070.1",
    "genusname": "Taxus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010546.030.1",
    "genusname": "Taxus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004493.010.1",
    "genusname": "Taxus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004493.030.1",
    "genusname": "Taxus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010460.030.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010460.070.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010460.150.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005117.020.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005117.030.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005117.070.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005117.070.2",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008033.081.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008033.021.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008033.031.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000815.020.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000815.070.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003295.008.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003295.020.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003295.030.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010473.030.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000790.010.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000790.020.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000790.030.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005961.020.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005961.030.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010167.010.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010167.031.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010167.070.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003002.008.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003002.010.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003002.020.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003002.030.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003002.050.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004657.081.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004657.031.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004657.051.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004657.100.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000860.010.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000860.030.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010232.021.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000840.010.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000840.030.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "007395.010.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "007395.030.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005544.010.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005544.030.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000808.008.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000808.020.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000808.030.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000808.050.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000808.070.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000808.150.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005545.050.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "005545.070.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010309.031.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010309.070.1",
    "genusname": "Thuja",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008375.030.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008375.070.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008375.150.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008375.150.2",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008375.250.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003296.030.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003296.070.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008365.030.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008365.070.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008365.070.2",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008365.150.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008360.030.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008360.050.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008360.070.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008360.070.2",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008360.100.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000804.030.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000804.070.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000804.070.2",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "000804.150.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008361.030.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008361.070.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008361.070.2",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010459.030.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010459.150.1",
    "genusname": "Magnolia",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010846.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011862.050.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011168.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011168.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011168.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010713.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010713.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011717.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011717.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010018.031.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002769.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002769.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002769.070.2",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002769.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003160.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010845.031.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003311.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003311.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003311.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003279.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003279.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008689.031.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010290.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010290.031.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010290.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003620.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003620.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003620.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009135.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009135.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009135.070.2",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009135.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010714.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010714.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003500.020.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003520.020.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002222.020.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "002222.050.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004608.031.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004608.071.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004609.031.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004609.071.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003450.020.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003460.020.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003742.020.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003742.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003742.050.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003742.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003360.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003360.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003360.070.2",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003360.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003360.250.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003385.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010648.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010648.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "007848.031.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009086.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009086.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009086.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009086.150.2",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009086.250.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011233.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010091.020.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010091.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010091.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010091.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010889.020.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009080.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009080.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009080.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009080.250.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009080.450.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011234.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011234.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010804.020.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009079.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009079.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009079.070.2",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "009079.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011235.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011235.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010800.020.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010800.250.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010073.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010073.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011827.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003680.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "011184.021.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008546.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008546.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008546.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008546.250.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008547.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008547.031.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008547.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008547.070.2",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008547.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008547.250.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003139.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003139.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003139.070.2",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003139.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "003139.250.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004552.030.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004552.070.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "004552.150.1",
    "genusname": "Ilex",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "010379.051.1",
    "genusname": "Prunus",
    "assignedto": "ellen_ward"
  },
  {
    "itemcode": "008122.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008122.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008122.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008122.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008122.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004439.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008121.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008121.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008121.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008118.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008118.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008118.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008118.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008118.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005414.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005414.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005414.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005414.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000693.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000693.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000693.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000693.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008126.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008126.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008126.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008126.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008126.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001241.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008123.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008123.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005418.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004887.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004887.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008127.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010847.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005419.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005419.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008124.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008124.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008124.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008124.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005596.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010599.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003544.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003544.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003544.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001833.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001833.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010600.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001243.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001243.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001243.150.2",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000824.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000824.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000824.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000824.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000824.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005578.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010458.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011252.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010457.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010457.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011289.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008040.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008040.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008040.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008040.050.2",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008040.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008040.100.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008040.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008040.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008040.450.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000687.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000687.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000687.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000687.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000687.100.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000687.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008050.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008050.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008050.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001122.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001122.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001122.450.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010975.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000724.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000724.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000724.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000724.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008085.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008085.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008085.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008085.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008085.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010974.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010974.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010974.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002643.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002643.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002643.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002643.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002643.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002643.450.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000676.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000676.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000676.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000676.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000676.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008070.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008070.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008070.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008070.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008070.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008070.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008090.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008090.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008090.030.2",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008090.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008090.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008090.100.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008090.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001134.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001134.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001134.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001134.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001134.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004127.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004127.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004127.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004127.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008100.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008100.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000927.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008116.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007733.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008120.008.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008120.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008120.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008120.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008120.150.2",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010991.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004352.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004352.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004352.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003195.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003195.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003195.150.2",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003195.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011550.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008095.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008095.030.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008095.050.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008095.070.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008095.150.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008095.250.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "006774.010.1",
    "genusname": "Acer",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004087.050.1",
    "genusname": "Aesculus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004087.100.1",
    "genusname": "Aesculus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010058.010.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010058.030.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010058.070.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010058.150.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011689.150.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008155.010.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008156.070.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008180.010.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008180.030.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008180.050.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008181.050.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008181.070.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008181.070.2",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008181.100.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008181.150.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008181.450.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011559.010.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011814.250.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002350.010.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002350.070.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011275.150.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011567.100.1",
    "genusname": "Betula",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011788.100.1",
    "genusname": "Aesculus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010636.030.1",
    "genusname": "Carpinus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010636.070.1",
    "genusname": "Carpinus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010636.150.1",
    "genusname": "Carpinus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010634.030.1",
    "genusname": "Carpinus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010634.070.1",
    "genusname": "Carpinus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010634.150.1",
    "genusname": "Carpinus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008190.030.1",
    "genusname": "Castanea",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008190.070.1",
    "genusname": "Castanea",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004088.050.1",
    "genusname": "Catalpa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004088.070.1",
    "genusname": "Catalpa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004088.150.1",
    "genusname": "Catalpa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004088.450.1",
    "genusname": "Catalpa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008308.030.1",
    "genusname": "Celtis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008308.070.1",
    "genusname": "Celtis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008308.100.1",
    "genusname": "Celtis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007734.070.1",
    "genusname": "Celtis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007734.100.1",
    "genusname": "Celtis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007734.150.1",
    "genusname": "Celtis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007734.250.1",
    "genusname": "Celtis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008615.030.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008615.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008615.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008615.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007578.030.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007578.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007578.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007578.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007578.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005577.030.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005577.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005577.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005577.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005577.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002499.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002499.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002499.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002499.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002499.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002499.250.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005918.030.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005918.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005918.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005918.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005918.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005918.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005918.250.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008613.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008613.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008613.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008613.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010767.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010767.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011537.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011537.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010768.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010768.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010768.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008614.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008614.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008614.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008614.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010370.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010370.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010370.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010370.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010370.250.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010373.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010373.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010373.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010373.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010373.250.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010373.450.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004373.030.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004373.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004373.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004373.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008097.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "009177.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "009177.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010881.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010881.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008306.030.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008306.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008306.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008306.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008306.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008306.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008306.250.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008306.450.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010372.031.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010372.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010372.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010372.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010372.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010933.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010933.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008200.010.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008200.030.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008200.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008200.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008200.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008200.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008200.250.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008200.450.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008201.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008201.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008201.100.2",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008028.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008028.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008028.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008028.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008028.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004185.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004185.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004185.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004185.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004185.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004185.250.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005576.030.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005576.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005576.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005576.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004374.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004374.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004374.051.2",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004374.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004374.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005607.031.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005607.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005607.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005607.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005607.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005607.250.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010670.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010670.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010670.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008210.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008210.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008210.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008210.250.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008211.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008211.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003198.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003198.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003198.150.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010932.050.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010932.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010932.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008801.051.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008801.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008801.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008193.070.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008193.100.1",
    "genusname": "Cercis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001516.010.1",
    "genusname": "Chionanthus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001516.030.1",
    "genusname": "Chionanthus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008229.030.1",
    "genusname": "Cornus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010880.050.1",
    "genusname": "Cornus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007700.050.1",
    "genusname": "Cornus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008220.030.1",
    "genusname": "Cornus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008230.008.1",
    "genusname": "Cornus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008230.030.1",
    "genusname": "Cornus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008230.050.1",
    "genusname": "Cornus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008230.070.1",
    "genusname": "Cornus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008249.008.1",
    "genusname": "Cornus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000727.070.1",
    "genusname": "Crataegus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000727.150.1",
    "genusname": "Crataegus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008240.050.1",
    "genusname": "Crataegus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "006081.070.1",
    "genusname": "Diospyros",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "006081.150.1",
    "genusname": "Diospyros",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008251.050.1",
    "genusname": "Fraxinus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008251.070.1",
    "genusname": "Fraxinus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008251.150.1",
    "genusname": "Fraxinus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "006082.010.1",
    "genusname": "Ginkgo",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "006082.050.1",
    "genusname": "Ginkgo",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "006082.070.1",
    "genusname": "Ginkgo",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011539.010.1",
    "genusname": "Ginkgo",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011539.070.1",
    "genusname": "Ginkgo",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008275.050.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008275.070.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008275.150.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008275.250.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008275.450.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008270.050.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008270.070.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008270.100.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008270.150.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008270.250.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008280.050.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008280.070.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008280.100.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008280.150.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008280.250.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008280.250.2",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "009198.050.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "009198.070.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "009198.070.2",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "009198.100.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "009198.150.1",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "009198.150.2",
    "genusname": "Gleditsia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005321.030.1",
    "genusname": "Gymnocladus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005321.050.1",
    "genusname": "Gymnocladus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005321.070.1",
    "genusname": "Gymnocladus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005321.250.1",
    "genusname": "Gymnocladus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008300.008.1",
    "genusname": "Koelreuteria",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008300.030.1",
    "genusname": "Koelreuteria",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008300.070.1",
    "genusname": "Koelreuteria",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008300.150.1",
    "genusname": "Koelreuteria",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008300.250.1",
    "genusname": "Koelreuteria",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011879.070.1",
    "genusname": "Liquidambar",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004631.070.1",
    "genusname": "Liquidambar",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004631.150.1",
    "genusname": "Liquidambar",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008315.010.1",
    "genusname": "Liquidambar",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008340.030.1",
    "genusname": "Liriodendron",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008340.050.1",
    "genusname": "Liriodendron",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008340.070.1",
    "genusname": "Liriodendron",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008340.250.1",
    "genusname": "Liriodendron",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003201.070.1",
    "genusname": "Liriodendron",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003201.250.1",
    "genusname": "Liriodendron",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004518.050.1",
    "genusname": "Liriodendron",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004518.070.1",
    "genusname": "Liriodendron",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010642.030.1",
    "genusname": "Liriodendron",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010642.070.1",
    "genusname": "Liriodendron",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008465.050.2",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008465.250.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008520.070.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008520.150.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008545.450.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008570.070.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008570.150.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008587.100.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008585.050.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008585.070.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008464.100.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008464.150.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008343.010.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008343.030.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008343.050.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008343.050.2",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008343.070.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008343.150.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008343.250.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008343.450.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007821.010.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007821.030.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007821.050.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007821.070.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007821.070.2",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007821.100.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007821.150.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007821.450.1",
    "genusname": "Metasequoia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008593.070.1",
    "genusname": "Morus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008600.010.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008600.030.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008600.050.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008600.070.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008600.070.2",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008600.150.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "006775.010.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004256.030.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004256.050.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004256.070.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004256.100.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007750.010.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007750.050.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007750.070.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007750.100.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011187.030.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011187.070.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008944.030.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008944.050.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008944.070.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008944.100.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010639.030.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010639.070.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010639.150.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010715.030.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010715.050.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010715.070.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010715.100.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003973.030.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003973.050.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003973.070.1",
    "genusname": "Nyssa",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010177.150.1",
    "genusname": "Parrotia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008605.008.1",
    "genusname": "Pistacia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008605.030.1",
    "genusname": "Pistacia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008605.050.1",
    "genusname": "Pistacia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008605.070.1",
    "genusname": "Pistacia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008605.100.1",
    "genusname": "Pistacia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008605.150.1",
    "genusname": "Pistacia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008605.250.1",
    "genusname": "Pistacia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004836.010.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004836.051.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004836.070.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004836.150.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004836.250.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004836.450.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008803.050.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008803.070.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008803.150.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008620.030.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005220.031.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005220.051.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005220.070.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005220.150.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005220.250.1",
    "genusname": "Platanus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011728.030.1",
    "genusname": "Populus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008625.030.1",
    "genusname": "Populus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008625.030.2",
    "genusname": "Populus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008625.050.1",
    "genusname": "Populus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008625.070.1",
    "genusname": "Populus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008625.150.1",
    "genusname": "Populus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003533.150.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008675.030.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008675.070.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000924.050.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000924.070.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000924.100.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001914.050.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008681.030.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008681.050.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008681.070.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008681.150.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008681.250.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008664.030.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008664.050.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008664.070.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008664.070.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010092.050.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010972.070.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010972.150.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010971.070.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010971.100.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008666.050.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008666.070.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008730.050.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008730.070.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008730.100.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008730.150.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008740.070.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008740.100.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008744.050.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008744.070.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008744.070.2",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008744.150.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008744.250.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008735.050.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008735.070.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008735.100.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008735.150.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008735.250.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008760.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008760.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008760.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008760.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008765.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008765.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008765.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008765.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008765.100.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008767.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008767.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008767.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008767.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008767.150.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008767.250.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011595.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010653.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010653.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011745.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010380.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010380.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010380.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010380.150.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010371.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010371.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010371.150.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010651.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011598.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005354.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008032.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008032.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008777.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008777.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008777.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008777.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008777.150.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008777.250.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008777.450.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000946.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000946.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000946.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000946.150.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008780.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008780.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008780.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008780.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008780.150.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000789.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000789.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000789.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010635.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010635.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010461.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011734.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011596.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008790.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008790.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008790.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008790.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008790.150.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008790.250.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008790.450.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008800.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008800.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008800.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008800.050.2",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008800.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008800.150.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010638.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010638.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010637.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010637.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010746.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008770.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008770.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008770.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008770.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008770.150.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008770.250.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008770.450.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010645.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010645.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008810.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008810.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008810.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008810.050.2",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008810.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008810.150.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008810.250.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008810.450.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011181.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011181.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011181.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011181.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011181.150.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011720.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011720.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000951.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000951.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000951.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011072.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000950.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000950.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000950.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000950.150.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008820.010.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008820.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008820.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008820.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008820.070.2",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004522.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004522.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004522.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002193.030.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002193.050.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "002193.070.1",
    "genusname": "Quercus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007745.070.1",
    "genusname": "Robinia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007745.100.1",
    "genusname": "Robinia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007745.250.1",
    "genusname": "Robinia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007745.450.1",
    "genusname": "Robinia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008850.030.1",
    "genusname": "Salix",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008850.050.1",
    "genusname": "Salix",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008835.050.1",
    "genusname": "Salix",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008836.010.1",
    "genusname": "Salix",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008836.050.1",
    "genusname": "Salix",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008836.070.1",
    "genusname": "Salix",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008840.050.1",
    "genusname": "Salix",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008840.150.1",
    "genusname": "Salix",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008845.050.1",
    "genusname": "Salix",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008830.030.1",
    "genusname": "Salix",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008830.050.1",
    "genusname": "Salix",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008830.150.1",
    "genusname": "Salix",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008862.030.1",
    "genusname": "Sophora",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008862.050.1",
    "genusname": "Sophora",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008862.070.1",
    "genusname": "Sophora",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008862.100.1",
    "genusname": "Sophora",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008875.010.1",
    "genusname": "Styrax",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008875.030.1",
    "genusname": "Styrax",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008875.070.1",
    "genusname": "Styrax",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010462.070.1",
    "genusname": "Styrax",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010462.150.1",
    "genusname": "Styrax",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011191.050.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008880.030.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008880.050.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008880.070.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008880.100.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008880.150.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008880.250.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008880.450.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004525.070.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005222.070.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005222.150.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005222.250.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003992.070.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003992.150.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004528.100.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004528.250.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010647.030.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010647.070.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010647.150.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011619.030.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011619.050.1",
    "genusname": "Taxodium",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011846.010.1",
    "genusname": "Tilia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000732.070.1",
    "genusname": "Tilia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "000732.150.1",
    "genusname": "Tilia",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003955.030.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003955.050.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003955.070.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010643.030.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010643.070.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010643.150.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004125.030.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004125.070.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004125.250.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008895.030.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010178.030.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010178.050.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010178.070.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010178.150.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003799.030.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003799.050.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003799.070.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003799.250.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004495.030.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004495.070.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004495.150.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004495.450.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003801.030.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003801.070.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "003801.150.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010381.030.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010381.050.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008900.030.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008900.050.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008900.070.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008900.150.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008900.250.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004122.030.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004122.070.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004122.100.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004122.150.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004122.450.1",
    "genusname": "Ulmus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010646.030.1",
    "genusname": "Zelkova",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010646.070.1",
    "genusname": "Zelkova",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004131.050.1",
    "genusname": "Zelkova",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004131.070.1",
    "genusname": "Zelkova",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005342.050.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005342.070.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005342.150.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005341.050.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005341.070.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005341.150.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008170.050.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008170.070.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008170.150.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008170.250.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005340.050.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005340.070.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005340.100.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005340.150.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005340.250.1",
    "genusname": "Carya",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007158.050.1",
    "genusname": "Diospyros",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007158.051.1",
    "genusname": "Diospyros",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007158.070.1",
    "genusname": "Diospyros",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005916.051.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008505.051.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "001253.051.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008525.031.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "009004.051.1",
    "genusname": "Malus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004133.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011821.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010341.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005365.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010342.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010343.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010343.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004026.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004026.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010375.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010375.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011822.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004029.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007704.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007704.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005118.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005118.031.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005118.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005907.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005907.031.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005907.050.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005907.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008690.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008690.031.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008690.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010733.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008700.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008700.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005908.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005908.031.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005908.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005904.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "007031.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010376.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008710.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008710.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010377.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010377.051.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008707.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008707.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008707.051.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008707.070.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010345.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005362.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010344.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010344.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008990.031.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008990.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008990.051.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005363.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "005363.051.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010951.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010951.051.2",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "006589.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "006589.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008695.031.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008695.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008648.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011823.051.1",
    "genusname": "Prunus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011012.051.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008750.051.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008738.031.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "010737.051.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "008747.051.1",
    "genusname": "Pyrus",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011295.021.1",
    "genusname": "Vitis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "011296.021.1",
    "genusname": "Vitis",
    "assignedto": "abigail_vazquez"
  },
  {
    "itemcode": "004110.030.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004110.070.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004110.150.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004110.250.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005201.030.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005675.030.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005675.070.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005675.150.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005675.150.2",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005675.250.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010811.030.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011561.030.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011561.250.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011830.030.1",
    "genusname": "Prunus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000909.020.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000909.030.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001020.030.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001993.010.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001993.011.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001993.021.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001993.031.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011259.021.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011259.031.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010678.031.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001060.010.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001060.030.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007358.010.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007358.021.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007358.031.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001030.020.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001030.030.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011271.030.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007429.031.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005818.031.1",
    "genusname": "Abelia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010818.020.1",
    "genusname": "Buxus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010818.050.1",
    "genusname": "Buxus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "009287.031.1",
    "genusname": "Ilex",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "009287.070.1",
    "genusname": "Ilex",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "009287.070.2",
    "genusname": "Ilex",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005380.050.1",
    "genusname": "Pyracantha",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003132.011.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003132.031.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000706.010.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000706.020.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000706.030.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "002226.020.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "002226.030.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "002050.020.1",
    "genusname": "Rosa",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "002050.050.1",
    "genusname": "Rosa",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003453.051.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "002190.050.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004666.050.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003563.030.1",
    "genusname": "Pyracantha",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003563.070.1",
    "genusname": "Pyracantha",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001224.070.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011290.070.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008267.070.1",
    "genusname": "Rosa",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011284.070.1",
    "genusname": "Cercis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006042.030.1",
    "genusname": "Magnolia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006042.070.1",
    "genusname": "Magnolia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008366.030.1",
    "genusname": "Magnolia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008366.070.1",
    "genusname": "Magnolia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008366.150.1",
    "genusname": "Magnolia",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008390.021.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010512.031.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000309.010.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000309.020.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000309.030.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008391.021.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000761.020.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010174.081.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010174.031.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006817.081.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006817.031.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006995.010.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006995.020.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006995.030.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011865.031.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006999.010.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007010.010.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007010.020.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007010.030.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003677.081.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003677.021.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003677.031.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005762.081.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005762.031.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005687.081.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005687.031.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010686.081.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010686.031.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005107.081.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005107.010.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005107.021.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005107.031.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008387.021.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007050.010.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007050.020.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007050.030.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "009354.031.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007025.081.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007025.010.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007025.021.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007025.031.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010176.031.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008389.021.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "009727.021.1",
    "genusname": "Weigela",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003585.011.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003585.021.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003585.031.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001584.010.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001584.020.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001584.030.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001545.020.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001545.030.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001602.010.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001602.020.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001602.030.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001620.010.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001620.020.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001620.030.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003186.011.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003186.031.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "002780.011.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "002780.021.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "002780.031.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001640.010.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001640.020.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001640.030.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001555.010.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001555.020.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001555.030.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004612.081.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004612.021.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004612.031.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008562.021.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011186.031.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010175.021.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010175.031.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011068.031.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011069.031.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003188.011.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003188.021.1",
    "genusname": "Berberis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008617.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008617.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008307.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008307.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010050.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010476.010.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010476.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010476.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000507.081.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000507.010.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000507.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000507.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000507.051.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000507.070.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005929.081.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005929.010.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005929.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005929.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "005929.051.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001929.081.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001929.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001929.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "001929.051.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011232.081.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011232.010.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011232.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011232.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010094.081.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010094.010.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010094.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010094.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008027.081.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008027.010.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008027.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008027.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008027.051.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003411.081.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003411.010.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003411.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003411.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003411.051.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003411.070.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010049.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "009015.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "009015.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006138.010.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006138.011.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006138.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006138.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006138.051.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010340.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011502.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008871.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007424.081.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007424.010.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007424.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010696.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006007.081.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006007.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010171.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003978.011.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003978.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003978.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003978.051.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003978.070.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "009244.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008616.010.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008616.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008616.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003090.030.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008870.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "008373.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010173.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010172.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006008.010.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006008.021.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "006008.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "009455.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011060.031.1",
    "genusname": "Hydrangea m.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003097.050.1",
    "genusname": "Hydrangea an.",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000809.010.1",
    "genusname": "Decumaria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "000809.030.1",
    "genusname": "Decumaria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004367.010.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003455.051.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011297.150.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "002188.050.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "007042.010.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011291.150.1",
    "genusname": "Wisteria",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004721.010.1",
    "genusname": "Parthenocissus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004721.030.1",
    "genusname": "Parthenocissus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004720.010.1",
    "genusname": "Parthenocissus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004720.030.1",
    "genusname": "Parthenocissus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "004720.050.1",
    "genusname": "Parthenocissus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010063.010.1",
    "genusname": "Parthenocissus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "010063.030.1",
    "genusname": "Parthenocissus",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "011397.031.1",
    "genusname": "Clematis",
    "assignedto": "megan_kelly"
  },
  {
    "itemcode": "003063.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003063.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008031.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008031.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000884.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000884.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003042.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003042.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "006621.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "006621.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011121.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "005618.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004398.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001378.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001378.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003058.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003058.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001363.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001363.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "007455.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003081.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003081.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003114.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003114.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003053.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003053.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011120.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000883.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000883.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003037.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003037.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003077.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003077.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000886.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000882.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000882.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003103.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003103.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "006619.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "006619.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003043.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003043.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003052.010.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003052.030.1",
    "genusname": "Hosta",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004804.010.1",
    "genusname": "Phlox",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002055.030.1",
    "genusname": "Chaenomeles",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "010687.031.1",
    "genusname": "Chaenomeles",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004211.031.1",
    "genusname": "Chaenomeles",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004208.031.1",
    "genusname": "Chaenomeles",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002060.010.1",
    "genusname": "Chaenomeles",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002060.030.1",
    "genusname": "Chaenomeles",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002060.050.1",
    "genusname": "Chaenomeles",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011837.030.1",
    "genusname": "Hesperaloe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002900.010.1",
    "genusname": "Hesperaloe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002900.030.1",
    "genusname": "Hesperaloe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002900.070.1",
    "genusname": "Hesperaloe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "006030.030.1",
    "genusname": "Hesperaloe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "007145.050.1",
    "genusname": "Yucca",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001349.010.1",
    "genusname": "Yucca",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001349.020.1",
    "genusname": "Yucca",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001349.030.1",
    "genusname": "Yucca",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "007160.030.1",
    "genusname": "Yucca",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "010960.031.1",
    "genusname": "Yucca",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011287.030.1",
    "genusname": "Yucca",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003034.030.1",
    "genusname": "Yucca",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "009337.030.1",
    "genusname": "Yucca",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001777.010.1",
    "genusname": "Clethra",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001777.030.1",
    "genusname": "Clethra",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001770.030.1",
    "genusname": "Clethra",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011398.031.1",
    "genusname": "Clethra",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001778.010.1",
    "genusname": "Clethra",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001778.030.1",
    "genusname": "Clethra",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000896.030.1",
    "genusname": "Clethra",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003609.031.1",
    "genusname": "Clethra",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004071.031.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008098.021.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008098.031.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004073.111.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004076.111.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004076.021.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004076.031.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004074.111.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004074.021.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004074.031.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000281.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000281.030.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002893.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000283.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000284.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002875.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000286.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000286.030.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002895.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002895.020.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000289.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000291.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000292.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001660.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000293.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002898.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002896.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002891.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001654.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000295.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000296.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002886.013.1",
    "genusname": "Hemerocallis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008808.010.1",
    "genusname": "Athyrium",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001153.010.1",
    "genusname": "Athyrium",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002088.010.1",
    "genusname": "Dryopteris",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000373.010.1",
    "genusname": "Matteuccia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011343.010.1",
    "genusname": "Osmunda",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002740.010.1",
    "genusname": "Forsythia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002740.030.1",
    "genusname": "Forsythia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002740.050.1",
    "genusname": "Forsythia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011836.020.1",
    "genusname": "Forsythia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003189.021.1",
    "genusname": "Forsythia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003189.031.1",
    "genusname": "Forsythia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002745.030.1",
    "genusname": "Forsythia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002745.050.1",
    "genusname": "Forsythia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "009305.020.1",
    "genusname": "Astilbe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "009305.030.1",
    "genusname": "Astilbe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "009309.020.1",
    "genusname": "Astilbe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "009309.030.1",
    "genusname": "Astilbe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "009308.020.1",
    "genusname": "Astilbe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "009308.030.1",
    "genusname": "Astilbe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008838.010.1",
    "genusname": "Salix",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008838.020.1",
    "genusname": "Salix",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008838.030.1",
    "genusname": "Salix",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008838.050.1",
    "genusname": "Salix",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008833.050.1",
    "genusname": "Salix",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008833.100.1",
    "genusname": "Salix",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "010664.030.1",
    "genusname": "Salix",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "010664.070.1",
    "genusname": "Salix",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "010664.150.1",
    "genusname": "Salix",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003953.031.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004545.010.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004545.020.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004545.030.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004766.031.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000914.030.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004540.020.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004540.030.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004540.050.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004540.070.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004540.150.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "007680.031.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004871.031.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001346.030.1",
    "genusname": "Nandina",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011013.010.1",
    "genusname": "Leucothoe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008692.021.1",
    "genusname": "Leucothoe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008692.031.1",
    "genusname": "Leucothoe",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001147.030.1",
    "genusname": "Aronia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001147.070.1",
    "genusname": "Aronia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001148.030.1",
    "genusname": "Aronia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001148.050.1",
    "genusname": "Aronia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001148.070.1",
    "genusname": "Aronia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011062.031.1",
    "genusname": "Aronia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "006843.070.1",
    "genusname": "Aronia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008310.031.1",
    "genusname": "Aronia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "006890.030.1",
    "genusname": "Aronia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "006890.050.1",
    "genusname": "Aronia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "006890.070.1",
    "genusname": "Aronia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "005751.030.1",
    "genusname": "Akebia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011170.070.1",
    "genusname": "Amelanchier",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011726.030.1",
    "genusname": "Artemisia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001180.020.1",
    "genusname": "Aucuba",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001650.010.1",
    "genusname": "Bignonia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001650.030.1",
    "genusname": "Bignonia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002134.011.1",
    "genusname": "Campsis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002134.031.1",
    "genusname": "Campsis",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "010690.031.1",
    "genusname": "Chitalpa",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "010690.071.1",
    "genusname": "Chitalpa",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008793.050.1",
    "genusname": "Cotinus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001840.030.1",
    "genusname": "Cotinus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001840.050.1",
    "genusname": "Cotinus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002224.030.1",
    "genusname": "Cotinus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002075.030.1",
    "genusname": "Cotinus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002075.050.1",
    "genusname": "Cotinus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002075.070.1",
    "genusname": "Cotinus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "010155.031.1",
    "genusname": "Distylium",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011723.030.1",
    "genusname": "Ericameria",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011724.030.1",
    "genusname": "Ericameria",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011725.030.1",
    "genusname": "Fallugia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "005441.011.1",
    "genusname": "Gelsemium",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "005441.031.1",
    "genusname": "Gelsemium",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "002861.010.1",
    "genusname": "Hedera",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011733.020.1",
    "genusname": "Hedera",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "010669.030.1",
    "genusname": "Heptacodium",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "010669.070.1",
    "genusname": "Heptacodium",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "000201.030.1",
    "genusname": "Ilex",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003523.010.1",
    "genusname": "Ilex",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "003523.070.1",
    "genusname": "Ilex",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008638.031.1",
    "genusname": "Loropetalum",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004084.030.1",
    "genusname": "Loropetalum",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011505.150.1",
    "genusname": "Myrica",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004480.030.1",
    "genusname": "Myrica",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011778.150.1",
    "genusname": "Olea",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011778.250.1",
    "genusname": "Olea",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004820.030.1",
    "genusname": "Photinia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004820.050.1",
    "genusname": "Photinia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "004820.070.1",
    "genusname": "Photinia",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008385.070.1",
    "genusname": "Prunus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "005180.020.1",
    "genusname": "Prunus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "005180.030.1",
    "genusname": "Prunus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "005180.050.1",
    "genusname": "Prunus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "005180.070.1",
    "genusname": "Prunus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "010093.070.1",
    "genusname": "Prunus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "005580.030.1",
    "genusname": "Rhamnus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001589.031.1",
    "genusname": "Rhamnus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "005800.030.1",
    "genusname": "Rhus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011727.030.1",
    "genusname": "Rhus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011834.010.1",
    "genusname": "Rhus",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "001524.030.1",
    "genusname": "Trachelospermum",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "011883.030.1",
    "genusname": "Viburnum",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "008887.031.1",
    "genusname": "Capsicum",
    "assignedto": "bobby_adair"
  },
  {
    "itemcode": "010987.030.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010987.050.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010987.070.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011569.250.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011487.050.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011487.100.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008380.030.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008380.050.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008380.070.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011279.031.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011279.070.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008410.030.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008410.050.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008410.070.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008350.030.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008350.050.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008350.070.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008350.100.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008350.150.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008345.010.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008345.030.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008345.050.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008345.070.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008345.100.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008358.030.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008358.050.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008358.070.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008358.100.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008358.150.1",
    "genusname": "Magnolia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011785.031.1",
    "genusname": "Lonicera",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011787.031.1",
    "genusname": "Lonicera",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011784.031.1",
    "genusname": "Lonicera",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "001806.081.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "001806.031.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004219.081.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004219.031.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003658.081.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003658.011.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003658.031.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003656.081.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003656.031.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005662.081.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005662.031.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008128.081.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008128.031.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010717.081.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010717.031.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003541.081.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003541.031.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003755.081.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003755.031.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "009394.081.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "009394.031.1",
    "genusname": "Rubus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003804.031.1",
    "genusname": "Vaccinium",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "007925.031.1",
    "genusname": "Vaccinium",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003811.031.1",
    "genusname": "Vaccinium",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003918.031.1",
    "genusname": "Vaccinium",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "007619.031.1",
    "genusname": "Vaccinium",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003822.021.1",
    "genusname": "Vitis",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003816.021.1",
    "genusname": "Vitis",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005663.021.1",
    "genusname": "Vitis",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005664.021.1",
    "genusname": "Vitis",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005666.021.1",
    "genusname": "Vitis",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003818.021.1",
    "genusname": "Vitis",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005189.021.1",
    "genusname": "Vitis",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002285.008.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002285.020.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002285.030.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002285.050.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006639.070.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "001407.031.1",
    "genusname": "Ficus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "001408.031.1",
    "genusname": "Ficus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008299.081.1",
    "genusname": "Ficus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008299.031.1",
    "genusname": "Ficus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "007411.081.1",
    "genusname": "Ficus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "007411.011.1",
    "genusname": "Ficus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "007411.031.1",
    "genusname": "Ficus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010166.021.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010166.031.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002430.010.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002430.020.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002430.030.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005643.010.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005643.030.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002480.010.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002480.030.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002600.010.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002600.020.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002600.030.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002600.050.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006933.010.1",
    "genusname": "Vinca",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "001111.010.1",
    "genusname": "Vinca",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006940.010.1",
    "genusname": "Vinca",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006855.010.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006855.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006855.050.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006792.010.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006792.020.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006792.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006792.050.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003812.020.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003812.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003812.070.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006798.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006798.070.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006795.010.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006795.020.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006795.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006795.050.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006795.070.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005827.010.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005827.021.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005827.031.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005667.010.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005667.021.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005667.031.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005667.051.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005667.070.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006821.031.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006821.051.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006821.071.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006809.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006809.050.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008799.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006810.010.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006810.020.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006810.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006810.050.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006810.070.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003191.021.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003191.031.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003191.071.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006840.010.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006840.020.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006840.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006840.050.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006825.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008867.021.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008867.031.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006905.010.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006905.020.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006905.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006905.050.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006905.070.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006860.010.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006860.020.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006860.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006860.050.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006860.070.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010352.030.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010352.050.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010352.070.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011871.070.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011871.100.1",
    "genusname": "Viburnum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002300.010.1",
    "genusname": "Euonymus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011014.031.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005761.081.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005761.021.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005761.031.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010683.021.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011059.021.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006997.011.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006997.021.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006997.050.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006997.070.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010708.030.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010708.051.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010708.070.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "009726.021.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011884.030.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006625.030.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006640.010.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006640.020.1",
    "genusname": "Syringa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004120.030.1",
    "genusname": "Ligustrum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004120.070.1",
    "genusname": "Ligustrum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004320.010.1",
    "genusname": "Ligustrum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "000752.030.1",
    "genusname": "Ligustrum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "000753.030.1",
    "genusname": "Ligustrum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010688.021.1",
    "genusname": "Philadelphus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008813.020.1",
    "genusname": "Philadelphus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011828.030.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "007494.021.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "007494.031.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "007494.051.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010548.051.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004246.030.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002083.020.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002083.030.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002083.050.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "000712.050.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "000712.070.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011882.030.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004905.020.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004905.030.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "001695.050.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011820.030.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008868.031.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "008868.051.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004248.021.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004248.031.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005273.081.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005273.021.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005273.031.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005273.051.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011070.021.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011070.031.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011076.021.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011824.031.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "001341.031.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "010698.031.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "011507.031.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "003294.051.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006410.021.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006410.031.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "006410.051.1",
    "genusname": "Physocarpus",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004242.081.1",
    "genusname": "Ligustrum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004242.010.1",
    "genusname": "Ligustrum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004242.031.1",
    "genusname": "Ligustrum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "004242.070.1",
    "genusname": "Ligustrum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "000697.030.1",
    "genusname": "Leucophyllum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "009106.031.1",
    "genusname": "Leucophyllum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "009106.070.1",
    "genusname": "Leucophyllum",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "009364.030.1",
    "genusname": "Perovskia",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005230.050.1",
    "genusname": "Pyracantha",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "002217.030.1",
    "genusname": "Pyracantha",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "001711.030.1",
    "genusname": "Callicarpa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "001711.070.1",
    "genusname": "Callicarpa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "007683.031.1",
    "genusname": "Callicarpa",
    "assignedto": "jorge_colunga"
  },
  {
    "itemcode": "005940.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008303.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010495.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010494.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011307.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008853.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008852.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010783.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011508.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011508.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "002068.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007767.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008304.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008304.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008323.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008324.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008325.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011663.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010681.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011236.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "002007.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "002007.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006616.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005992.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005995.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010716.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011815.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011816.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011509.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006160.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006160.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006160.050.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008396.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007853.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007853.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007433.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007433.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007433.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007431.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007431.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007431.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007912.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007912.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007432.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007432.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007432.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "004383.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "004383.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "004383.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "004383.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "009471.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "009471.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010501.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010501.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010501.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003649.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003649.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003649.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003649.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003651.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003651.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003651.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003651.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003652.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003652.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003652.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003652.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005706.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005706.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005706.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005706.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003653.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003653.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003653.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003653.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011214.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011214.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011214.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011214.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011810.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "004388.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "004388.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "004388.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007537.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007537.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007537.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007537.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008137.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008137.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008137.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008137.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "001638.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "001638.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "001638.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "001638.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "001638.050.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "001638.070.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "002356.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "002356.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "002356.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "002356.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "002356.050.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010586.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010586.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010586.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010586.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010829.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005975.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005975.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005975.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005975.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005975.050.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010585.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010585.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010585.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010585.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008500.077.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008500.016.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "000945.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "000945.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "000945.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "000945.050.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003469.081.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003469.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003469.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003469.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011797.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007837.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007837.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "007837.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010855.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011662.050.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006202.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006202.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011661.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011661.050.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010854.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006219.050.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006238.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006232.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006232.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006232.050.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010531.050.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "004885.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "004885.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011850.150.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010857.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010245.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010697.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010246.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "000669.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006200.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010859.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006215.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006215.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010858.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006218.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010899.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006224.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "000622.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011301.050.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006363.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "000844.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006227.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006227.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010533.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010533.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010860.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006194.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006255.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006248.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010856.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006260.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006260.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010536.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010537.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006270.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010863.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010861.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006339.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010535.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010864.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006285.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "010853.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "000412.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "000412.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003147.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005268.010.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011176.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011176.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "006147.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003163.030.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "002508.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005405.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005406.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "005410.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "008501.021.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "002764.031.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "011175.020.1",
    "genusname": "Rosa",
    "assignedto": "mitch_kaiser"
  },
  {
    "itemcode": "003085.010.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003085.020.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003085.030.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003085.050.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "011231.031.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "011066.031.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003566.010.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003566.021.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003566.031.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003566.051.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "008861.021.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "008861.031.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "007850.031.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "011501.031.1",
    "genusname": "Hydrangea ar.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "008567.031.1",
    "genusname": "Hydrangea s.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003129.010.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003129.020.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003129.030.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003129.050.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003129.070.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003129.150.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "008866.010.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "008866.031.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "011058.031.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "011065.031.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "006879.021.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "006879.031.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "010349.021.1",
    "genusname": "Hydrangea q.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "009728.021.1",
    "genusname": "Hydrangea s.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "006751.021.1",
    "genusname": "Hydrangea s.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "006751.031.1",
    "genusname": "Hydrangea s.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "006752.021.1",
    "genusname": "Hydrangea s.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "006752.031.1",
    "genusname": "Hydrangea s.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "010695.031.1",
    "genusname": "Hydrangea s.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "008037.021.1",
    "genusname": "Hydrangea s.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "008037.031.1",
    "genusname": "Hydrangea s.",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001884.008.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001884.081.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001884.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001884.011.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001884.020.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001884.021.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001884.031.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001884.051.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001884.070.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001884.150.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "010327.031.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "011248.031.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "000880.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "000880.030.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "000880.050.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "000880.070.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "005629.031.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001682.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001682.020.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001682.030.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001682.050.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001682.070.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "007656.050.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "010888.050.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001677.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001677.020.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001677.030.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001677.050.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001677.070.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "010085.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "006736.030.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "006736.050.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "011716.020.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003150.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003150.021.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "003150.031.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "008404.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "004102.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "004102.030.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "004102.031.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "009245.021.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "009245.031.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "008497.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "008497.031.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "010515.020.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "010515.030.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001720.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001720.020.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001720.030.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001720.050.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001675.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001675.020.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001675.030.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001675.050.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001675.070.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001700.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001700.020.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001700.030.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001700.050.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001700.070.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "010663.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "010663.031.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "005844.031.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "011495.010.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "011495.031.1",
    "genusname": "Buxus",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001799.030.1",
    "genusname": "Camellia",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001798.030.1",
    "genusname": "Camellia",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001797.030.1",
    "genusname": "Camellia",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "001802.030.1",
    "genusname": "Camellia",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "007921.030.1",
    "genusname": "Camellia",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "002194.010.1",
    "genusname": "Fothergilla",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "002194.030.1",
    "genusname": "Fothergilla",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "002752.010.1",
    "genusname": "Fothergilla",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "002752.020.1",
    "genusname": "Fothergilla",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "002752.030.1",
    "genusname": "Fothergilla",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "002752.070.1",
    "genusname": "Fothergilla",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "010970.030.1",
    "genusname": "Fothergilla",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "009399.031.1",
    "genusname": "Fothergilla",
    "assignedto": "josh_vann"
  },
  {
    "itemcode": "009397.031.1",
    "genusname": "Fothergilla",
    "assignedto": "josh_vann"
  }
]
$assignment_rows$::jsonb) as x(itemcode text, genusname text, assignedto text)
), drive_rows as (
  select
    upper(btrim(mi.itemcode)) as itemcode_normalized,
    lower(regexp_replace(btrim(coalesce(mi.genusname, '')), '[[:space:]]+', ' ', 'g')) as genusname_normalized,
    max(mi.commonname) as commonname,
    max(mi.contsize) as contsize,
    max(mi.locationcode) as locationcode
  from public.ph_master_inventory mi
  where nullif(btrim(coalesce(mi.itemcode, '')), '') is not null
  group by
    upper(btrim(mi.itemcode)),
    lower(regexp_replace(btrim(coalesce(mi.genusname, '')), '[[:space:]]+', ' ', 'g'))
), resolved as (
  select
    s.*,
    d.commonname,
    d.contsize,
    d.locationcode,
    (d.itemcode_normalized is not null) as present_in_drive
  from source_rows s
  left join drive_rows d
    on d.itemcode_normalized = s.itemcode_normalized
   and d.genusname_normalized = s.genusname_normalized
)
insert into public.ph_warehouse_assigned_items (
  unique_id, itemcode, itemcode_normalized, genusname, genusname_normalized,
  concat, assignment_key, assignedto, assigned_by, assigned_at,
  commonname, contsize, locationcode, source, import_batch, raw_row,
  first_seen_at, last_seen_at, present_in_drive, updated_at, unassigned_notified_at
)
select
  'eval-itemcode-genus-' || md5(r.assignment_key),
  r.itemcode_normalized,
  r.itemcode_normalized,
  r.genusname,
  r.genusname_normalized,
  r.itemcode_normalized || r.genusname,
  r.assignment_key,
  r.assignedto,
  'sheet_complete_backfill_20260820',
  now(),
  r.commonname,
  r.contsize,
  r.locationcode,
  'google_sheet_cutover_20260820',
  'ALL IN ONE (9857 rows)',
  jsonb_build_object(
    'authority', 'supabase',
    'cutover_source', 'ALL IN ONE',
    'source_rows', 9857,
    'distinct_itemcode_genus_keys', 3307,
    'scope', 'itemcode_genus'
  ),
  now(),
  now(),
  r.present_in_drive,
  now(),
  now()
from resolved r
on conflict (assignment_key) where assignment_key is not null
do update set
  itemcode = excluded.itemcode,
  itemcode_normalized = excluded.itemcode_normalized,
  genusname = excluded.genusname,
  genusname_normalized = excluded.genusname_normalized,
  concat = excluded.concat,
  assignedto = case
    when public.ph_warehouse_assigned_items.source = 'supabase_assignment_manager'
      and nullif(btrim(coalesce(public.ph_warehouse_assigned_items.assignedto, '')), '') is not null
      then public.ph_warehouse_assigned_items.assignedto
    else excluded.assignedto
  end,
  assigned_by = case
    when public.ph_warehouse_assigned_items.source = 'supabase_assignment_manager'
      and nullif(btrim(coalesce(public.ph_warehouse_assigned_items.assignedto, '')), '') is not null
      then public.ph_warehouse_assigned_items.assigned_by
    else excluded.assigned_by
  end,
  assigned_at = case
    when public.ph_warehouse_assigned_items.source = 'supabase_assignment_manager'
      and nullif(btrim(coalesce(public.ph_warehouse_assigned_items.assignedto, '')), '') is not null
      then public.ph_warehouse_assigned_items.assigned_at
    else excluded.assigned_at
  end,
  commonname = coalesce(excluded.commonname, public.ph_warehouse_assigned_items.commonname),
  contsize = coalesce(excluded.contsize, public.ph_warehouse_assigned_items.contsize),
  locationcode = coalesce(excluded.locationcode, public.ph_warehouse_assigned_items.locationcode),
  source = case
    when public.ph_warehouse_assigned_items.source = 'supabase_assignment_manager'
      and nullif(btrim(coalesce(public.ph_warehouse_assigned_items.assignedto, '')), '') is not null
      then public.ph_warehouse_assigned_items.source
    else excluded.source
  end,
  import_batch = case
    when public.ph_warehouse_assigned_items.source = 'supabase_assignment_manager'
      and nullif(btrim(coalesce(public.ph_warehouse_assigned_items.assignedto, '')), '') is not null
      then public.ph_warehouse_assigned_items.import_batch
    else excluded.import_batch
  end,
  raw_row = case
    when public.ph_warehouse_assigned_items.source = 'supabase_assignment_manager'
      and nullif(btrim(coalesce(public.ph_warehouse_assigned_items.assignedto, '')), '') is not null
      then public.ph_warehouse_assigned_items.raw_row
    else excluded.raw_row
  end,
  last_seen_at = now(),
  present_in_drive = excluded.present_in_drive,
  updated_at = now(),
  unassigned_notified_at = now();

update public.ph_request_delivery_outbox o
set
  status = 'suppressed',
  next_attempt_at = null,
  sanitized_error_code = 'ASSIGNMENT_RESOLVED',
  updated_at = now()
where o.event_type = 'eval_assignment_unassigned'
  and o.status <> 'delivered'
  and exists (
    select 1
    from public.ph_warehouse_assigned_items a
    where nullif(btrim(coalesce(a.assignedto, '')), '') is not null
      and o.event_key = 'eval-unassigned:' || md5(a.assignment_key)
  );

select public.reconcile_eval_itemcodes();

comment on table public.ph_warehouse_assigned_items is
  'Supabase-authoritative Eval assignments keyed by normalized ItemCode + GenusName; complete 9,857-row Sheet cutover applied 2026-08-20.';

notify pgrst, 'reload schema';

commit;
