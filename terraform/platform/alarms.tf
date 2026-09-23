# Alarms on the load balancer, emailed through splitx-alerts (the
# splitx-guardrails stack admits alarms named splitx-* in this region).
#
# The AWS Load Balancer Controller makes the ALB from the Ingresses at run
# time, so it doesn't exist when this root is first planned. aws-up applies
# the root again with alb_ready = true once the Ingress has an address; the
# ALB is found by the tags the controller puts on it (its cluster, and the
# IngressGroup "splitx" that k8s/overlays/aws uses). Destroy removes the alarms
# with everything else, and never looks the ALB up (alb_ready defaults to
# false), so it works after the ALB is gone.
#
# There are no CloudFront alarms: CloudFront's metrics exist only in us-east-1,
# an alarm can only notify a topic in its own region, and /ops shows the edge
# live (D-088).

data "aws_lb" "app" {
  count = var.alb_ready ? 1 : 0

  tags = {
    "elbv2.k8s.aws/cluster" = var.cluster_name
    "ingress.k8s.aws/stack" = "splitx"
  }
}

# The app's own answers: more than 5% server errors in 3 of 5 minutes, once
# there is traffic worth judging (over 20 requests a minute). Deliberate load
# shedding (D-046) counts too: a classroom seeing 503s should be known about.
resource "aws_cloudwatch_metric_alarm" "app_errors" {
  count = var.alb_ready ? 1 : 0

  alarm_name          = "splitx-alb-app-5xx"
  alarm_description   = "Over 5% of the app's responses through the load balancer were 5xx, in 3 of the last 5 minutes."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 5
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = [local.alert_topic_arn]
  ok_actions          = [local.alert_topic_arn]

  metric_query {
    id          = "percent"
    expression  = "IF(requests > 20, 100 * errors / requests, 0)"
    label       = "5xx responses (%)"
    return_data = true
  }

  metric_query {
    id = "errors"

    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      dimensions  = { LoadBalancer = data.aws_lb.app[0].arn_suffix }
      period      = 60
      stat        = "Sum"
    }
  }

  metric_query {
    id = "requests"

    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      dimensions  = { LoadBalancer = data.aws_lb.app[0].arn_suffix }
      period      = 60
      stat        = "Sum"
    }
  }
}

# The load balancer's own errors: no healthy pod to send to, or a pod that
# timed out. More than 10 in five minutes.
resource "aws_cloudwatch_metric_alarm" "edge_errors" {
  count = var.alb_ready ? 1 : 0

  alarm_name          = "splitx-alb-5xx"
  alarm_description   = "The load balancer itself answered 5xx (no healthy target, or a timeout) more than 10 times in 5 minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  dimensions          = { LoadBalancer = data.aws_lb.app[0].arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = [local.alert_topic_arn]
  ok_actions          = [local.alert_topic_arn]
}
